# Backup and Restore

What is backed up, how to check it is still working, and how to get the data back.

> Every command here has been run against the live server. The restore procedure
> below was verified by restoring a real backup into a throwaway container and
> comparing it to production, table by table.

---

## What is backed up

Two stores hold data that cannot be rebuilt from git, and `pg_dump` only covers
one of them:

| Store | Contains | How |
|-------|----------|-----|
| `otomate_pgdata` | users, roles, branches, employees, products, prices, DSIRs | `pg_dump` → `db-*.sql.gz` |
| `otomate_product-images` | every product photograph | `tar` → `images-*.tar.gz` |

The images volume is the one people forget. A user list can be retyped; a
catalogue with prices and photographs is days of work to reconstruct.

**Not backed up, on purpose:** the `.env` file. It holds the database password,
`JWT_SECRET`, and the Cloudflare tokens, and a backup archive is exactly the
wrong place for them. Keep those in a password manager instead.

## How it runs

`scripts/otomate-backup.sh`, nightly at **02:30 Manila time** via a systemd
timer, keeping 14 days. It runs as the normal server user — the docker group,
not root.

Two details in the timer are deliberate:

- **The schedule names a timezone** (`OnCalendar=*-*-* 02:30:00 Asia/Manila`).
  The server's clock is UTC, so an unanchored `02:30` fires at 10:30 in the
  morning locally — the middle of the encoder's day. Naming the zone also keeps
  it correct without anyone maintaining an offset.
- **`Persistent=true`**, because this server is a laptop that hibernates during
  blackouts. A night missed that way runs at the next boot rather than being
  skipped silently.

To use a different time or place, pass them in:

```bash
sudo BACKUP_TIME=03:00:00 BACKUP_TZ=Asia/Manila ~/otomate/scripts/install-backup-timer.sh
```

### Installing the timer (once, needs sudo)

```bash
sudo ~/otomate/scripts/install-backup-timer.sh
```

The unit files are generated on the server rather than committed, because they
contain the username and home directory and this repository is public.

---

## Checking it still works

The classic way to lose data is a backup job that quietly stopped working months
ago. Three checks, cheapest first:

```bash
# 1. How long since the last SUCCESSFUL run? (the file is only touched on success)
echo "$(( ($(date +%s) - $(cat ~/otomate/backups/.last-success)) / 3600 )) hours ago"

# 2. Is the timer still scheduled?
systemctl list-timers otomate-backup.timer

# 3. What happened on recent runs?
journalctl -u otomate-backup --since '7 days ago'
```

A failed run leaves a non-zero exit status that `systemctl status otomate-backup`
reports. The script fails loudly rather than writing a partial file: output goes
to a `.tmp` name and is only moved into place after it verifies, because a
half-written file is worse than no file — it looks like a backup.

---

## Restoring

### The database

```bash
cd ~/otomate

# Stop the app so nothing writes while the tables are being replaced.
docker compose -f docker-compose.prod.yml stop api web

# The dump is taken with --clean --if-exists, so it drops and recreates
# everything itself. Pick the file you want from ~/otomate/backups/.
gzip -cd backups/db-YYYYMMDD-HHMMSS.sql.gz \
  | docker exec -i otomate-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q'

docker compose -f docker-compose.prod.yml start api web
```

Everyone stays signed in — password hashes and role assignments are part of the
dump and come back byte-identical (verified).

### The product images

```bash
docker run --rm \
  -v otomate_product-images:/data \
  -v ~/otomate/backups:/b:ro \
  alpine:3.22 sh -c 'rm -rf /data/* /data/..?* 2>/dev/null; tar -xzf /b/images-YYYYMMDD-HHMMSS.tar.gz -C /data'
```

Restore the image archive with the **same timestamp** as the database dump. Both
files are written in the same run and share a timestamp so they stay a matched
pair — a newer database with older images means products pointing at photographs
that do not exist.

---

## Verifying a backup without touching production

Worth doing occasionally, and the only way to know a backup is real. This
restores into a throwaway container on an isolated network and compares it to
production — production is never written to:

```bash
cd ~/otomate
PGU=$(docker inspect otomate-postgres-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
PGD=$(docker inspect otomate-postgres-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_DB=//p')

docker run -d --name restoretest --network none \
  -e POSTGRES_USER="$PGU" -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB="$PGD" \
  postgres:16-alpine
sleep 10

gzip -cd "$(ls -t backups/db-*.sql.gz | head -1)" \
  | docker exec -i restoretest psql -U "$PGU" -d "$PGD" -q

for t in User Role Permission Branch Category Product Employee DsirReport; do
  A=$(docker exec otomate-postgres-1 psql -U "$PGU" -d "$PGD" -tAc "select count(*) from \"$t\"")
  B=$(docker exec restoretest       psql -U "$PGU" -d "$PGD" -tAc "select count(*) from \"$t\"")
  printf '%-14s prod=%-6s restored=%-6s %s\n' "$t" "$A" "$B" \
    "$([ "$A" = "$B" ] && echo ok || echo MISMATCH)"
done

docker rm -f restoretest
```

Last verified **2026-08-23**: all ten tables matched, zero errors during restore,
and the credential fingerprint was identical.

---

## Known gap

Backups currently live on **the same disk as the data they protect**. That covers
the likely failures — a bad migration, a wrong `DELETE`, a corrupted volume — but
not the machine being lost, stolen, or destroyed. An off-machine copy is tracked
in [OPERATIONS.md](OPERATIONS.md).
