#!/usr/bin/env bash
#
# Zero-downtime deploy for the stateless services (api, web).
#
# `docker compose up -d` stops the old container before the new one is ready, so
# for ~15s Traefik has no backend and the site returns 404. Instead, for each
# service: start the new container alongside the old, wait for it to report
# healthy, and only then remove the old one.
#
# This works because Traefik's Docker provider only creates a server for a
# container once Docker reports it *healthy* — verified against traefik:v3 for
# both the "unhealthy" and the "starting" states. So the new container takes no
# traffic until it is ready, and the old one keeps serving until it is removed.
#
# Requires each rolled service to define a HEALTHCHECK (api and web both do, in
# their Dockerfiles) and to publish no host ports — two containers cannot bind
# the same port. Only Traefik publishes ports here.
#
#   ./scripts/rollout.sh api web

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
DRAIN_SECONDS="${DRAIN_SECONDS:-3}"

log() { printf '[rollout] %s\n' "$*"; }
die() { printf '[rollout] FAILED: %s\n' "$*" >&2; exit 1; }

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# A container with no HEALTHCHECK never reports health, and waiting on one would
# hang until the timeout. Treat "running" as ready in that case, and say so.
health_of() {
  docker inspect --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}no-healthcheck{{else}}down{{end}}' \
    "$1" 2>/dev/null || echo gone
}

wait_healthy() {
  local id=$1 name deadline
  name=$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's|^/||')
  deadline=$((SECONDS + HEALTH_TIMEOUT))

  while [ "$SECONDS" -lt "$deadline" ]; do
    case "$(health_of "$id")" in
      healthy)        log "  $name is healthy"; return 0 ;;
      no-healthcheck) log "  $name is running (no HEALTHCHECK — cannot confirm readiness)"; return 0 ;;
      unhealthy)      return 1 ;;
      gone|down)      return 1 ;;
    esac
    sleep 2
  done
  log "  $name did not become healthy within ${HEALTH_TIMEOUT}s"
  return 1
}

rollout_service() {
  local svc=$1 old_ids old_count new_id all_ids

  old_ids=$(dc ps -q "$svc" || true)
  old_count=$(printf '%s' "$old_ids" | grep -c . || true)

  if [ "$old_count" -eq 0 ]; then
    log "$svc: nothing running, starting it normally"
    dc up -d --no-deps "$svc"
    return 0
  fi

  log "$svc: starting a replacement alongside $old_count running container(s)"

  # --no-recreate keeps the current container untouched even though the image
  # changed; --scale then adds one more, which compose creates from the NEW
  # image. That is the whole trick.
  dc up -d --no-deps --no-recreate --scale "$svc=$((old_count + 1))" "$svc" >/dev/null

  all_ids=$(dc ps -q "$svc")
  new_id=$(comm -13 <(printf '%s\n' "$old_ids" | sort) <(printf '%s\n' "$all_ids" | sort) | head -1)
  [ -n "$new_id" ] || die "$svc: could not identify the new container"

  if ! wait_healthy "$new_id"; then
    # The old container is still serving, so the safe move is to bin the new one
    # and leave the site on the previous version rather than press on.
    log "$svc: replacement is not healthy — rolling back, old container keeps serving"
    docker logs --tail 30 "$new_id" 2>&1 | sed 's/^/      /' || true
    docker rm -f "$new_id" >/dev/null 2>&1 || true
    dc up -d --no-deps --no-recreate --scale "$svc=$old_count" "$svc" >/dev/null 2>&1 || true
    die "$svc: rollout aborted, previous version left running"
  fi

  # Both are healthy and in Traefik's pool now. A moment here lets any request
  # already dispatched to the old container finish before it goes away.
  sleep "$DRAIN_SECONDS"

  log "$svc: removing the previous container(s)"
  # shellcheck disable=SC2086
  docker stop --timeout 15 $old_ids >/dev/null
  # shellcheck disable=SC2086
  docker rm $old_ids >/dev/null

  # Re-sync compose's desired scale, now that only the new container remains.
  dc up -d --no-deps --no-recreate --scale "$svc=$old_count" "$svc" >/dev/null

  log "$svc: done"
}

[ $# -gt 0 ] || die "usage: rollout.sh <service> [service...]"

for svc in "$@"; do
  rollout_service "$svc"
done

log "all services rolled"
