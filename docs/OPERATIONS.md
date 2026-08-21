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

### 2. Dynamic public IP keeps breaking things

**Status:** Not fixed. Worked around by hand each time.

Observed **three different addresses within three days**. Actual values are kept in
local notes / the password manager, not here.
The address changes whenever the router reboots (e.g. after a blackout).

**Already broken by this once:** the GitHub Actions deploy failed at `Copy compose
file to server` because the `SERVER_HOST` secret held a stale IP. Bookmarks break too.

**Confirmed not CGNAT** — traceroute hop 2 from the server is a public ISP gateway in
the same /16 as the public IP; a carrier-NAT path would show `100.64.0.0/10`. Self-hosting
is viable; the address is simply dynamic.

**What to do:** DuckDNS (free) or a purchased domain, plus a DDNS updater on the
server; point `SERVER_HOST` at the hostname instead of an IP. This also unlocks
Let's Encrypt, already stubbed out in `traefik/traefik.yml`.

---

## 🟠 Medium

### 3. The JWT secret should be rotated

**Status:** Not done. The production `JWT_SECRET` was printed in full in a terminal
on 2026-08-20 while diagnosing an unrelated issue.

Anyone holding it can forge an admin token — `requirePermission` trusts a validly
signed token's identity. Risk is currently low (LAN-only in practice, one user),
and rises sharply once the app is publicly reachable or real staff accounts exist.

**What to do:** generate `openssl rand -hex 32` (hex deliberately — no `$`, `/` or
quotes to be mangled), replace it in `~/otomate/.env`, restart the api. Everyone is
signed out and logs in again.

### 4. CI has no typecheck, lint or test gate

`.github/workflows/deploy.yml` goes straight from `push` to building images to
production. Nothing verifies the code first — every deploy so far has been gated
only by a local `tsc --noEmit` run by hand.

**What to do:** add a job running `pnpm -r exec tsc --noEmit` as a `needs:`
prerequisite of `build-and-push`.

### 5. The server does not power itself back on

It is a laptop (`chassis_type: 10`). Lid close is already ignored, but UPower's
default `CriticalPowerAction=HybridSleep` at 2% battery still applies — which is
correct behaviour and is why the database survived the blackout intact. The gap is
that nothing turns the machine back on when mains power returns.

**What to do:** enable *Restore on AC Power Loss* / *AC Recovery* in BIOS/UEFI.
Requires physical access at boot. The battery is effectively a built-in UPS; this
is the missing half.

### 6. There are no automated tests

Every feature so far has been verified by driving the running app. That has caught
real bugs a build could not — but it is manual and not repeatable in CI.

---

## 🟡 Low — known, documented, not urgent

### 7. `@types/express@^5` is paired with `express@^4.21.2`

A types/runtime major mismatch. It has already produced one confusing failure:
`req.params.id` typed as `string | string[]`, which silently broke Prisma's type
inference three files away. Worked around with `pathParam()` in `apps/api/src/lib/http.ts`.
Aligning the types to `^4` is a small, isolated change.

### 8. Server `.env` values are unquoted

A `$` in a password is expanded by any script that sources the file, corrupting
`DATABASE_URL` (Prisma reports `P1013: invalid port number`, which points nowhere
near the real cause). Docker Compose parses `.env` without expanding, which is why
the containers work. Documented in `docs/CONVENTIONS.md`.

**What to do:** single-quote the values in `~/otomate/.env`. Compose strips the quotes.

### 9. Frontend bundle is not code-split

~740 KB (~225 KB gzipped) in one chunk. Fine today; worth `manualChunks` or route-level
`lazy()` once there are more pages.

---

## Closed

- **Prisma migrations** — baselined and applied to production 2026-08-20. `migrate deploy`
  now reports "No pending migrations to apply".
- **Async errors crashing the API** — Express 4 does not catch rejected promises;
  a DB blip during login terminated the process. Fixed with error middleware.
- **Permissions frozen in the JWT for 7 days** — role changes and deactivations now
  take effect on the next request.
