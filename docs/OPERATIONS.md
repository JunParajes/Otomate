# Operations — Known Gaps & Deferred Work

Things that are **not** done, why they matter, and what to do about them.
Reviewed and updated as items are closed. Newest concerns at the top of each section.

---

## 🔴 High — do these before real staff depend on the system

### 1. There are no automated backups

**Status:** Not started. The only database dump in existence was taken by hand on
2026-08-20 (`~/otomate/backups/` on the server).

**Why it matters:** There are now **two** separate stores of real data:

| Store | Contains | Covered by `pg_dump`? |
|-------|----------|----------------------|
| Postgres (`otomate_pgdata`) | users, roles, branches, products, prices | yes |
| `product-images` volume | every product photograph | **no** |

The server is a repurposed laptop that hibernated for 3.5 hours during a blackout
on 2026-08-20. A user list can be retyped; a product catalogue with prices and
photographs is days of work to reconstruct.

**What to do:** a nightly `pg_dump` plus a `tar` of the images volume, on a systemd
timer, retained ~14 days, with at least one copy off the machine. Needs `sudo` on
the server, so it needs the user at the keyboard.

## 🟠 Medium

### 2. CI has no typecheck, lint or test gate

`.github/workflows/deploy.yml` goes straight from `push` to building images to
production. Nothing verifies the code first — every deploy so far has been gated
only by a local `tsc --noEmit` run by hand.

**What to do:** add a job running `pnpm -r exec tsc --noEmit` as a `needs:`
prerequisite of `build-and-push`.

### 3. The server does not power itself back on

It is a laptop (`chassis_type: 10`). Lid close is already ignored, but UPower's
default `CriticalPowerAction=HybridSleep` at 2% battery still applies — which is
correct behaviour and is why the database survived the blackout intact. The gap is
that nothing turns the machine back on when mains power returns.

**What to do:** enable *Restore on AC Power Loss* / *AC Recovery* in BIOS/UEFI.
Requires physical access at boot. The battery is effectively a built-in UPS; this
is the missing half.

### 4. There are no automated tests

Every feature so far has been verified by driving the running app. That has caught
real bugs a build could not — but it is manual and not repeatable in CI.

---

## 🟡 Low — known, documented, not urgent

### 5. `@types/express@^5` is paired with `express@^4.21.2`

A types/runtime major mismatch. It has already produced one confusing failure:
`req.params.id` typed as `string | string[]`, which silently broke Prisma's type
inference three files away. Worked around with `pathParam()` in `apps/api/src/lib/http.ts`.
Aligning the types to `^4` is a small, isolated change.

### 6. Server `.env` values are unquoted

A `$` in a password is expanded by any script that sources the file, corrupting
`DATABASE_URL` (Prisma reports `P1013: invalid port number`, which points nowhere
near the real cause). Docker Compose parses `.env` without expanding, which is why
the containers work. Documented in `docs/CONVENTIONS.md`.

**What to do:** single-quote the values in `~/otomate/.env`. Compose strips the quotes.

### 7. Frontend bundle is not code-split

~740 KB (~225 KB gzipped) in one chunk. Fine today; worth `manualChunks` or route-level
`lazy()` once there are more pages.

---

## Closed

- **Prisma migrations** — baselined and applied to production 2026-08-20. `migrate deploy`
  now reports "No pending migrations to apply".
- **Async errors crashing the API** — Express 4 does not catch rejected promises;
  a DB blip during login terminated the process. Fixed with error middleware.
- **Dynamic public IP** — solved 2026-08-22. A Cloudflare Tunnel serves the app
  (outbound, so no address to go stale) and a DDNS container keeps
  `server.otomate.uk` current for SSH. `SERVER_HOST` is a hostname now, not an IP.
  See [DOMAIN-SETUP.md](DOMAIN-SETUP.md).
- **No HTTPS** — solved 2026-08-22. TLS terminates at Cloudflare, certificate
  auto-renewing. Also removed the need for any inbound port forwarding.
- **Permissions frozen in the JWT for 7 days** — role changes and deactivations now
  take effect on the next request.
- **JWT secret exposure** — rotated 2026-08-22. The production secret had been
  printed in full in a terminal on 2026-08-20. Any token signed with the old
  secret is now worthless.
- **No rate limiting on the login endpoint** — added 2026-08-23, once the app
  became publicly reachable. `POST /api/auth/login` runs bcrypt at cost 12: slow
  by design, which made it both a brute-force target and a cheap way for a
  stranger to burn CPU on a home server. Ten *failed* attempts per 15 minutes per
  client, plus a generous 1000/15min flood backstop across `/api`. See
  `apps/api/src/middleware/rate-limit.ts`.
- **Inbound port forwarding** — the router's port 80 forward was removed
  2026-08-23. The Cloudflare tunnel is outbound, so the home network now has no
  inbound web exposure at all.
