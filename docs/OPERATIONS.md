# Operations — Known Gaps & Deferred Work

Things that are **not** done, why they matter, and what to do about them.
Reviewed and updated as items are closed. Newest concerns at the top of each section.

This file holds the *reasoning*. [TODO.md](TODO.md) is the actionable list and
links back to these entries **by number** — so if you insert or renumber a gap
here, fix the references there too. (Gap 0 was inserted on 2026-08-30, which
renumbered everything below it.)

---

## 🟠 Medium

### 0b. The deploy seed used to overwrite a role change — FIXED 2026-08-30

Worth keeping as a warning about the shape of the mistake, not the mistake.

`prisma db seed` was added to every deploy on 2026-08-30 so new permissions would
reach production. The seed also contained a one-time bootstrap step that promoted
`admin@otomate.local` back to `super_admin` whenever it held any other role —
harmless when run by hand, wrong on every deploy.

The account had been deliberately set to `human_resource` through the admin UI.
The next deploy silently put it back, with nothing in the interface to explain
why. It would have kept happening.

Now the promotion only fires when there is no other **active** super admin, which
is the invariant it existed to protect. A deliberate demotion is respected.

**The general lesson:** a script written to bootstrap once has different
obligations once it runs on a schedule. Anything it forces will fight the people
using the app, and it wins silently. Before putting a bootstrap script in a
deploy loop, read every write it performs and ask which of them a user could
legitimately have changed.

### 0. A finalised report's figures are not actually frozen

**Status:** Open as of 2026-08-26. Found while adding draft deletion; the delete
path is now guarded, the underlying coupling is not.

Stock sent between branches is stored **once**, on the sending report, and read
live by the receiver (`loadInbound` in `apps/api/src/routes/admin/dsir.ts`). It
is never copied into the receiving report. So the receiver's *available* stock —
and therefore its derived **sold** and **sales** — is recomputed from the
sender's current data on every read, including after it has been finalised.

Measured, before the guard existed:

```
Branch B: opening 0, produced 100, received 20, ending 40  → sold 80, sales ₱240
Branch B finalised.
Branch A's DRAFT (which sent the 20) deleted.
Branch B, still FINALIZED, now reads:                        sold 60, sales ₱180
```

₱60 moved on a closed report. Variance is what gets deducted from a cashier's
wages (see [DOMAIN.md](DOMAIN.md)), so this is not cosmetic.

**What is guarded:** `DELETE /api/admin/dsir/:id` refuses when the draft's
transfers point at a branch whose report for that date is already finalised
(`RECEIVER_FINALIZED`), telling the operator to reopen it first.

**What is not:** editing or reopening the sending report still moves the
receiver's numbers, because nothing snapshots the inbound quantity. The real fix
is to freeze inbound transfers into the receiving report at finalisation, the
way `unitPriceCents` is already snapshotted onto `DsirLine` and for exactly the
same reason. That is a schema change plus a migration, so it has not been done
here.

### 1. SSH is exposed to the internet (password auth now off)

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


### 2. Backups are local only — no off-machine copy

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



### 3. CI has no typecheck gate — RESOLVED 2026-08-30

A `typecheck` job now gates `build-and-push`, which gates `deploy`. Nothing
reaches GHCR, and therefore nothing reaches production, unless every package
typechecks.

**The obvious one-liner does not work.** `pnpm -r exec tsc --noEmit` on a clean
checkout fails with 40+ errors that have nothing to do with the code:

- `packages/shared/dist` is gitignored, and api/web resolve `@otomate/shared` to
  that dist — so every import of it is "Cannot find module"
- `@prisma/client` is generated rather than committed, so `Branch`, `Prisma`,
  `Role` and `User` "have no exported member"

So the job builds shared and runs `prisma generate` first. Both were established
by running the sequence in a fresh clone, not by reasoning about it. Skipping
either would produce a gate that always fails, gets disabled within a week, and
protects nothing.

**Verified it can actually fail.** A deliberate type error was injected into
`packages/shared`, `apps/api` and `apps/web` in turn; each produced exit 1, and
removing it returned exit 0. A gate that cannot fail is theatre.

Still open: no lint step (there is no eslint in this project) and no tests —
see gap 5.

### 4. The server does not power itself back on

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

### 5. Automated tests — STARTED 2026-08-30, extended 2026-08-31

84 tests over the pure functions where a wrong answer costs money, run in CI as
part of the `verify` job. Nothing reaches production unless they pass.

Covered: the DSIR derivation (`computeLineTotals`, `isImpossibleLine`,
`looksLikeMissingInbound`), the count-expression parser, effective-dating
(`effectiveOn`, `deadlineStatus`) and the branch status helpers.

**Verified by mutation, not by watching them go green.** Each function was
deliberately broken and the suite re-run:

| Mutation | Caught |
|---|---|
| charges added instead of subtracted | yes |
| transfers-out counted as available | yes |
| `sold < 0` weakened to `sold < -1` | **no — test added** |
| rate start date excluded (`<=` → `<`) | yes |
| deadline window edge (`<=` → `<`) | yes |
| unpaid-bill bug reintroduced | yes |
| trailing junk accepted by the parser | yes |
| `×`/`x` aliases dropped | yes |

The third one is the point of doing this: nothing covered `sold === -1`, the
likeliest real miscount, so a weakened check would have passed. A test now
covers it. One mutation survives legitimately — removing the parser's
divide-by-zero guard changes nothing observable, because `!Number.isFinite`
catches the resulting Infinity anyway.

**Extended 2026-08-31 to integration tests against a real Postgres** — 119 tests
in total, with a service container in CI. What they cover is exactly what a mock
would answer confidently and wrongly, because it is a property of the database
and the query rather than of the code shape:

- which fields each permission does and does not return, for employees and for
  branches (permits, utilities and lease are three separate keys)
- the DSIR delete guards, including `RECEIVER_FINALIZED` and the reopen escape
  hatch
- gap 0 itself, pinned as a **characterisation test** asserting the current wrong
  behaviour. When gap 0 is fixed that test should fail; that is the signal
- that DATE columns survive a round trip
- the seed's role-promotion guard, so the 2026-08-30 regression cannot return

`apps/api/src/index.ts` was split: `app.ts` assembles the Express app, `index.ts`
runs it. The app could not previously be imported without opening a port and
installing signal handlers.

Two things the mutation pass found:

- **The date tests could not fail.** A DATE comes back as UTC midnight; read with
  `getDate()` instead of `getUTCDate()` it is the previous day only for anyone
  *behind* UTC. The dev machines here are UTC+8 and GitHub's runners are UTC, so
  both agreed and the bug was invisible. The API suite now pins
  `TZ=America/Los_Angeles`, which is what makes those tests able to fail at all.
- **A survivor that is fine:** removing the serializer's salary check leaks
  nothing, because `includeFor` never fetches the rows without the permission.
  Two layers, and both must fail.

The suite refuses to run unless `DATABASE_URL` looks disposable — it truncates
every table — and redacts the password when it refuses.

**Extended 2026-08-31 to the browser** — 9 Playwright tests, 128 in total, in
their own CI job so a slow browser run does not sit in front of the fast
feedback. Deliberately small, and every one maps to something that has actually
broken here:

- an expression commits its result, `×` is understood rather than stripped to
  make 45, and a half-typed `4*` restores the previous value instead of keeping
  the fragment that happened to parse
- the account menu follows a rename without a reload (the bug fixed in 604d83a —
  nothing is wrong server-side in that state, so no API test can see it)
- the UI hides what the server would refuse, *and* shows it to a role that holds
  the permission — the mirror matters, or "not visible" could just mean the
  feature was deleted

The report they run against is seeded **through the API**, not by driving the
create-report and add-product dialogs. Those flows are covered by the API tests,
and reaching the inputs through four dialogs makes a test fail for reasons that
have nothing to do with what it checks.

Two things worth knowing for anyone changing them:

- `locator.blur()` does not commit a value here. React's `onBlur` listens for
  `focusout`, which `element.blur()` does not bubble. Use `press('Tab')` — also
  closer to what a person does.
- `vite preview` serves a bundle that already exists, and `VITE_API_URL` is baked
  in at BUILD time. Setting it on the preview server alone leaves the app calling
  whatever host it was compiled against, and every request fails with no clue
  why. The config builds and previews in one command.

Verified by mutation: removing the session refresh reintroduces 604d83a and fails
the account-menu test; making the count boxes strip operators again fails three.

---
---

## 🟡 Low — known, documented, not urgent

### 6. `@types/express@^5` is paired with `express@^4.21.2`

A types/runtime major mismatch. It has already produced one confusing failure:
`req.params.id` typed as `string | string[]`, which silently broke Prisma's type
inference three files away. Worked around with `pathParam()` in `apps/api/src/lib/http.ts`.
Aligning the types to `^4` is a small, isolated change.

### 7. Server `.env` values are unquoted — RESOLVED 2026-08-30

All ten values in `~/otomate/.env` are now single-quoted.

**The advice previously given here was wrong.** It said "single-quote the values;
Compose strips the quotes". Compose does not merely strip them — single quotes
suppress *interpolation*, which changes the resolved value. Measured:

| `.env` line | container receives |
|---|---|
| `SECRET=pa$$w0rd$USER` | `pa$w0rdjun` |
| `SECRET="pa$$w0rd$USER"` | `pa$w0rdjun` (double quotes do not protect) |
| `SECRET='pa$$w0rd$USER'` | `pa$$w0rd$USER` |

Following the old advice blindly on a password with an expandable sequence would
have changed what Postgres received and broken the API's connection.

**How it was done safely:** back up `.env`, rewrite with single quotes, then diff
`docker compose config --format json` before and after and keep the change only
if every resolved value is byte-identical. All 14 values across the six services
matched, so nothing needed restarting — the running containers already held the
correct values, and the fix only affects future reads.

**Honest scope:** the trap was latent, not active. Sourcing the *old* file also
produced the correct password — today's `$` happens to sit where neither bash nor
Compose expands it. The next password might not, and the failure is silent. See
[CONVENTIONS.md](CONVENTIONS.md).

A rollback copy is at `~/otomate/.env.bak-20260830-140437`. Delete it once you are
satisfied — it is a second unquoted copy of every secret.

### 8. Frontend bundle is not code-split — RESOLVED 2026-09-01

Was one 961.6 KB file. Now 32 chunks: vendor code split from app code, and every
route lazy-loaded.

Measured in a browser, service worker disabled so it reflects a first visit:

| | Before | After |
|---|---|---|
| Login page download | 961.6 KB, 1 file | **524.3 KB, 5 files** |
| Largest chunk | 961.6 KB | 339.7 KB (Mantine) |
| Total on disk | 961.6 KB | 949.7 KB, 32 chunks |

Two wins, one of them the bigger:

**First paint halves.** Signing in used to download the DSIR grid, the image
uploader and every admin screen before showing a password box.

**A deploy stops invalidating everything.** This is a PWA with a precache and
several deploys a day. As one file, each deploy meant every tablet re-fetching
the lot, including a copy of React unchanged in months. Split, an app edit
invalidates ~162 KB of app chunks — and only the pages actually visited —
while `vendor-react` and `vendor-mantine` stay cached until genuinely upgraded.

**The trap, found while doing it:** `@mantine/dropzone/styles.css` was imported
in `main.tsx`. That is a stylesheet, but importing it creates a dependency edge
from the entry chunk to the package, which dragged `react-dropzone` and
`file-selector` — 60 KB of image-upload code — onto the login page. Moved to
`ImageDropzone.tsx`, the only component that uses it. The same ordering trap
applies in `manualChunks`: the `@mantine/dropzone` rule must come before the
generic `@mantine` one, or it lands in the eager vendor chunk.

Held in place by `apps/web/e2e/bundle.spec.ts`, which asserts the login page
downloads neither the uploader nor the DSIR grid. One stray import undoes this
silently, with nothing to show but a slower first paint.

Not done: `@tabler/icons-react` needed nothing — it tree-shakes to 19.8 KB.

---
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
