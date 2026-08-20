#!/usr/bin/env bash
#
# One-time baseline for a production database whose schema was created with
# `prisma db push` (i.e. before migrations existed).
#
# Such a database already has the tables but no migration history, so the first
# `prisma migrate deploy` after 0_init lands would try to CREATE TABLE over the
# live tables and fail. This records 0_init as already-applied so future
# migrations deploy normally.
#
# Note: `_prisma_migrations` may already EXIST but be EMPTY — `migrate deploy`
# creates the table even when it finds no migrations to apply. So the presence
# of that table proves nothing; only an applied row for the baseline does.
#
# Safe to re-run: it inspects the DB and does nothing unless a baseline is
# actually needed.
#
# Run once, on the server, from ~/otomate:
#   bash scripts/baseline-prod-db.sh
#
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
BASELINE_MIGRATION="0_init"

if [[ ! -f .env ]]; then
  echo "error: .env not found in $(pwd)" >&2
  exit 1
fi

# Deliberately NOT `. ./.env`: bash performs parameter expansion on unquoted
# values, so a password containing `$` (e.g. `...$` right before the `@`) is
# silently mangled and DATABASE_URL becomes invalid (Prisma P1013). Docker
# Compose reads .env itself without expanding, so we only pull out the two
# plain values psql needs and let Compose handle DATABASE_URL.
env_value() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
POSTGRES_USER=$(env_value POSTGRES_USER)
POSTGRES_DB=$(env_value POSTGRES_DB)

if [[ -z "$POSTGRES_USER" || -z "$POSTGRES_DB" ]]; then
  echo "error: POSTGRES_USER or POSTGRES_DB missing from .env" >&2
  exit 1
fi

echo "==> Ensuring postgres is up"
$COMPOSE up -d postgres
until $COMPOSE exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" </dev/null >/dev/null 2>&1; do
  echo "    waiting for postgres..."
  sleep 2
done

# </dev/null matters: `compose exec -T` otherwise consumes this script from stdin
# when it is piped in (e.g. `ssh host 'bash -s' < script`).
query() {
  $COMPOSE exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" </dev/null 2>/dev/null | tr -d '[:space:]'
}

schema_exists=$(query "SELECT to_regclass('public.\"User\"') IS NOT NULL")
history_exists=$(query "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")

if [[ "$schema_exists" != "t" ]]; then
  echo "==> Database has no schema yet — no baseline needed."
  echo "    'prisma migrate deploy' will create it from scratch."
  exit 0
fi

if [[ "$history_exists" == "t" ]]; then
  applied=$(query "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$BASELINE_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")
  if [[ "${applied:-0}" -gt 0 ]]; then
    echo "==> '$BASELINE_MIGRATION' is already recorded as applied — nothing to do."
    exit 0
  fi
  total=$(query "SELECT count(*) FROM _prisma_migrations")
  echo "==> _prisma_migrations exists with ${total:-0} row(s), none of them '$BASELINE_MIGRATION'."
fi

# The currently-deployed api image may predate the migrations folder, and
# `migrate resolve` needs the migration on disk to compute its checksum. If a
# migrations dir sits next to this script, mount it over the image's copy.
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(pwd)/migrations}"
mount_args=()
if [[ -d "$MIGRATIONS_DIR/$BASELINE_MIGRATION" ]]; then
  echo "==> Mounting $MIGRATIONS_DIR into the api container"
  mount_args=(-v "$MIGRATIONS_DIR:/app/apps/api/prisma/migrations:ro")
fi

echo "==> Existing schema with no baseline record. Marking '$BASELINE_MIGRATION' as applied."
$COMPOSE run --rm -T "${mount_args[@]}" api sh -c "npx prisma migrate resolve --applied $BASELINE_MIGRATION" </dev/null

echo "==> Baseline complete. Verifying with 'migrate status':"
$COMPOSE run --rm -T "${mount_args[@]}" api sh -c "npx prisma migrate status" </dev/null || true
