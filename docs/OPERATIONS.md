# Operations — Known Gaps & Deferred Work

Things that are **not** done, why they matter, and what to do about them.
Reviewed and updated as items are closed. Newest concerns at the top of each section.

---

## 🟠 Medium

### 0. SSH is exposed to the internet (password auth now off)

**Status:** Open as of 2026-08-26. `server.otomate.uk` resolves to the public IP
and the router forwards a port to SSH, which is how deploys reach the machine.
Measured on the server: **876 failed logins from 266 distinct IPs**, against
generic usernames (admin, support, operator, ubnt), and sshd answers
`publickey,password` — so passwords are being accepted.

`fail2ban` is active and absorbing most of it, and the scanning is untargeted
rather than aimed at this business. That is luck, not a defence.

**Resolved 2026-08-26:** password authentication is disabled — the server now
answers `publickey` only, so the brute-force traffic has nothing to guess at.
Note that a drop-in under `/etc/ssh/sshd_config.d/` did **not** take effect on
this machine despite a correct `Include`; the setting had to go directly into
`sshd_config` above that line. See [REMOTE-ACCESS.md](REMOTE-ACCESS.md).

**Still open — decision 2026-08-26:** the port forward **stays for now**. Moving admin access
to Tailscale was considered and deferred; the arrangement is what makes remote
access work today, and it is not being changed while travelling.

**Still worth doing on its own:** turning off password authentication is a
two-line change ([REMOTE-ACCESS.md](REMOTE-ACCESS.md) step 1). It does not alter
how access works — keys already carry every real login — and it is what makes
those 876 attempts unwinnable rather than merely slow. The rest of the plan is
kept in that document for when this is picked up again.


### 1. Backups are local only — no off-machine copy

**Status:** Nightly backups run as of 2026-08-23 — `pg_dump` plus a tar of the
`product-images` volume, 14 days retained, on a systemd timer. The restore
procedure is written down and **verified**: a real backup was restored into a
throwaway container and compared to production table by table, credential
fingerprint included. See [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

Every copy lives on the same disk as the data it protects. That covers the
likely failures — a bad migration, a wrong `DELETE`, a corrupted volume — but
not the machine being lost, stolen, or destroyed. The server is a repurposed
laptop in a house.

**Deliberately deferred on 2026-08-23**, with the local backups judged enough for
now. Revisit when real staff data accumulates — particularly once product
photographs exist, since those are the part that cannot be retyped.

**When it is picked up:** the options weighed were Cloudflare R2 (no new vendor,
free at this size, genuinely off-site), a nightly pull to the owner's Mac (no
account needed, but same building and only while the Mac is awake), and an
external USB drive (offline, but same building). Whatever is chosen should be
encrypted before it leaves the server — the dump contains password hashes and
employee records. `gpg` is already installed.



### 2. CI has no typecheck, lint or test gate

`.github/workflows/deploy.yml` goes straight from `push` to building images to
production. Nothing verifies the code first — every deploy so far has been gated
only by a local `tsc --noEmit` run by hand.

**What to do:** add a job running `pnpm -r exec tsc --noEmit` as a `needs:`
prerequisite of `build-and-push`.

### 3. The server does not power itself back on

**Measured 2026-08-26:** at 2% battery UPower runs `CriticalPowerAction=HybridSleep`,
which leaves the machine *suspended* — and a suspended machine ignores AC
returning, because resuming needs a wake event. It also tries to hibernate 7.1 GB
of RAM into a 4 GB swap file, which is not guaranteed to succeed under load.

Two changes, in [REMOTE-ACCESS.md](REMOTE-ACCESS.md): set the critical action to
`PowerOff` so there is something for AC-restore to boot, and enable *Restore on
AC Power Loss* in firmware. The second needs physical access and is the only
part of the remote-access work that cannot be done from away.

This matters more now than it did: once admin access moves to Tailscale and the
SSH forward closes, a machine that does not boot has no route back in at all.

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

  The rate-limit key deserves a note, because the tunnel breaks the obvious
  approach. Every tunnelled request reaches Traefik from the same `cloudflared`
  container, so `X-Forwarded-For` ends in one address for the entire internet
  and would put every visitor in a single bucket. `CF-Connecting-IP` is used
  instead: Cloudflare sets it at the edge and returns **403** to any request that
  arrives already carrying one, so over the tunnel it cannot be forged — verified
  against production, not assumed.

  On the LAN there is no Cloudflare, and a first cut of this trusted the header
  unconditionally — measured on the live server, a LAN client could invent a new
  value per request and collect a fresh allowance every time. The header is now
  trusted only when the peer is a container on the Docker network (172.16/12),
  which is the only route tunnelled traffic can take and one a LAN client cannot
  fake. A mismatch logs a throttled warning, which is also the alarm if the
  Docker network is ever renumbered.
- **No automated backups** — closed 2026-08-23. Nightly `pg_dump` plus a tar of
  the `product-images` volume, 14 days retained, on a systemd timer with
  `Persistent=true` so a night missed to a blackout runs at the next boot. The
  restore was verified against production, not just written down. An off-machine
  copy remains open above, by decision rather than oversight.
- **Inbound port forwarding** — the router's port 80 forward was removed
  2026-08-23. The Cloudflare tunnel is outbound, so the home network now has no
  inbound web exposure at all.
