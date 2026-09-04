#!/usr/bin/env bash
#
# Nightly backup of everything that cannot be rebuilt from git.
#
# There are TWO stores of real data, and pg_dump only covers one of them:
#
#   otomate_pgdata          users, roles, branches, employees, products,
#                           prices, DSIR reports                     -> pg_dump
#   otomate_product-images  every product photograph                 -> tar
#
# A user list can be retyped. A catalogue with prices and photographs is days
# of work to reconstruct, so the images volume is not optional.
#
# Runs as the ordinary server user (needs docker group, not root).
# Installed on a systemd timer by scripts/install-backup-timer.sh.

set -euo pipefail

# Owner-only, for everything this script creates.
#
# A dump is the whole database in one readable file: names, addresses, birth
# dates, SSS and PhilHealth numbers, salaries. It was being written 0644, so any
# account on the box — or anything running as one — could read the lot without
# touching Postgres at all. The database itself demands a password; its backup
# should not be the way around that.
#
# Set before anything is created rather than chmod'ed afterwards: a file written
# world-readable and corrected a second later was still world-readable for that
# second.
umask 077

BACKUP_DIR="${BACKUP_DIR:-$HOME/otomate/backups}"
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/otomate}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz"
IMG_FILE="$BACKUP_DIR/images-$STAMP.tar.gz"

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] FAILED: %s\n' "$*" >&2; exit 1; }

# Anything half-written is worse than nothing — it looks like a backup.
cleanup_partials() { rm -f "$DB_FILE.tmp" "$IMG_FILE.tmp"; }
trap cleanup_partials EXIT

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$COMPOSE_DIR" || die "no compose directory at $COMPOSE_DIR"

# ---------------------------------------------------------------- database ---

PG_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)"
[ -n "$PG_CONTAINER" ] || die "the postgres container is not running — nothing was backed up"

# pg_dump runs INSIDE the container and reads POSTGRES_USER/POSTGRES_DB from the
# container's own environment. The database password therefore never reaches the
# host, this script, or the process list.
log "dumping database..."
if ! docker exec "$PG_CONTAINER" sh -c \
      'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists' \
      2>/dev/null | gzip -9 > "$DB_FILE.tmp"; then
  die "pg_dump failed"
fi

# A dump that ends early still gzips cleanly and still looks like a file. The
# only trustworthy check is pg_dump's own end-of-output marker.
#
# The window is deliberately far wider than needed. pg_dump appends its own
# trailing lines and adds to them across releases: PostgreSQL 16.10 introduced a
# `\unrestrict` line after the marker, which alone pushed it to 5 lines from the
# end. A tight window turns a routine Postgres upgrade into "every backup fails",
# and because this is a hard failure that would mean no backups at all.
gzip -t "$DB_FILE.tmp" 2>/dev/null || die "the dump is not valid gzip"
if ! gzip -cd "$DB_FILE.tmp" | tail -50 | grep -q 'PostgreSQL database dump complete'; then
  die "the dump is truncated — pg_dump did not reach the end"
fi
mv "$DB_FILE.tmp" "$DB_FILE"
log "database -> $(basename "$DB_FILE") ($(du -h "$DB_FILE" | cut -f1))"

# ------------------------------------------------------------------ images ---

# Resolved by compose label rather than hardcoded, so renaming the project or
# the directory cannot silently start backing up nothing.
IMG_VOLUME="$(docker volume ls -q \
  --filter 'label=com.docker.compose.volume=product-images' | head -1)"
[ -n "$IMG_VOLUME" ] || die "could not find the product-images volume"

log "archiving images from $IMG_VOLUME..."
docker run --rm -v "$IMG_VOLUME:/data:ro" alpine:3.22 \
  tar -czf - -C /data . > "$IMG_FILE.tmp" 2>/dev/null \
  || die "could not archive the images volume"

gzip -t "$IMG_FILE.tmp" 2>/dev/null || die "the image archive is not valid gzip"
mv "$IMG_FILE.tmp" "$IMG_FILE"
log "images -> $(basename "$IMG_FILE") ($(du -h "$IMG_FILE" | cut -f1), $(tar -tzf "$IMG_FILE" | grep -c . | tr -d '[:space:]' || true) entries)"

# --------------------------------------------------------------- retention ---

# Both files carry the same timestamp, so they age out together.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'db-*.sql.gz' -o -name 'images-*.tar.gz' \) \
  -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d '[:space:]')"
[ "$DELETED" -gt 0 ] && log "pruned $DELETED file(s) older than $RETENTION_DAYS days"

KEPT="$(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sql.gz' | wc -l | tr -d '[:space:]')"

# The classic way to lose data is a backup job that quietly stopped working
# months ago. Touching this only on success makes staleness checkable with one
# command — see docs/BACKUP-RESTORE.md.
date +%s > "$BACKUP_DIR/.last-success"

log "done — $KEPT database backup(s) held, $(du -sh "$BACKUP_DIR" | cut -f1) total"
