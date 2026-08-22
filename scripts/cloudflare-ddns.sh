#!/bin/sh
# Keeps one Cloudflare DNS A record pointing at this machine's public IP.
#
# WHY THIS EXISTS: the server is on a residential line with a dynamic address.
# It has already changed several times, and each change broke the GitHub Actions
# deploy because SERVER_HOST held a raw IP. Pointing SERVER_HOST at a hostname
# this script maintains removes that failure permanently.
#
# The APP does not need this — it is reached through a Cloudflare Tunnel, which
# is an outbound connection and does not care about the address. This is only
# for SSH, which cannot go through the tunnel without extra client tooling.
#
# Required: CF_API_TOKEN (Zone:DNS:Edit), CF_ZONE_NAME, CF_RECORD_NAME
# Optional: CF_INTERVAL (seconds, default 300)
set -eu

: "${CF_API_TOKEN:?CF_API_TOKEN is required}"
: "${CF_ZONE_NAME:?CF_ZONE_NAME is required}"
: "${CF_RECORD_NAME:?CF_RECORD_NAME is required}"
INTERVAL="${CF_INTERVAL:-300}"
API="https://api.cloudflare.com/client/v4"
AUTH="Authorization: Bearer ${CF_API_TOKEN}"

log() { echo "[ddns $(date -u +%H:%M:%S)] $*"; }

api() { curl -sS --max-time 20 -H "$AUTH" -H "Content-Type: application/json" "$@"; }

# Cloudflare's own trace endpoint — no extra third party, and we already depend
# on Cloudflare for the tunnel.
public_ip() { curl -sS --max-time 15 https://cloudflare.com/cdn-cgi/trace | sed -n 's/^ip=//p'; }

zone_id=""
record_id=""
last_ip=""

resolve_ids() {
  zone_id=$(api "${API}/zones?name=${CF_ZONE_NAME}" | jq -r '.result[0].id // empty')
  [ -n "$zone_id" ] || { log "ERROR: zone ${CF_ZONE_NAME} not found — check the token's zone scope"; return 1; }
  record_id=$(api "${API}/zones/${zone_id}/dns_records?type=A&name=${CF_RECORD_NAME}" | jq -r '.result[0].id // empty')
  if [ -z "$record_id" ]; then
    log "record ${CF_RECORD_NAME} does not exist yet — creating it"
    ip=$(public_ip)
    # proxied:false is REQUIRED — Cloudflare cannot proxy SSH, and a proxied
    # record would resolve to Cloudflare's edge instead of this machine.
    record_id=$(api -X POST "${API}/zones/${zone_id}/dns_records" \
      --data "{\"type\":\"A\",\"name\":\"${CF_RECORD_NAME}\",\"content\":\"${ip}\",\"ttl\":120,\"proxied\":false}" \
      | jq -r '.result.id // empty')
    [ -n "$record_id" ] || { log "ERROR: could not create the record"; return 1; }
    last_ip="$ip"
    log "created ${CF_RECORD_NAME} -> ${ip}"
  fi
  return 0
}

log "watching ${CF_RECORD_NAME} in ${CF_ZONE_NAME}, every ${INTERVAL}s"

while :; do
  if [ -z "$zone_id" ] || [ -z "$record_id" ]; then
    resolve_ids || { sleep "$INTERVAL"; continue; }
  fi

  ip=$(public_ip || true)
  if [ -z "$ip" ]; then
    log "could not determine the public IP; will retry"
    sleep "$INTERVAL"; continue
  fi

  if [ "$ip" != "$last_ip" ]; then
    current=$(api "${API}/zones/${zone_id}/dns_records/${record_id}" | jq -r '.result.content // empty')
    if [ "$ip" = "$current" ]; then
      # Already correct — record it locally so we stop re-checking every cycle.
      last_ip="$ip"
      log "no change (${ip})"
    else
      ok=$(api -X PATCH "${API}/zones/${zone_id}/dns_records/${record_id}" \
        --data "{\"content\":\"${ip}\"}" | jq -r '.success')
      if [ "$ok" = "true" ]; then
        last_ip="$ip"
        log "UPDATED ${CF_RECORD_NAME}: ${current:-none} -> ${ip}"
      else
        log "ERROR: update failed; will retry"
      fi
    fi
  fi

  sleep "$INTERVAL"
done
