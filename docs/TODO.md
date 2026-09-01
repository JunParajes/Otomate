# To Do

Everything outstanding, in one place. Newest state at the top of each section.

**This file is an index, not a spec.** Each item says what to do and where the
reasoning lives. The *why* stays in [ROADMAP.md](ROADMAP.md) (features),
[OPERATIONS.md](OPERATIONS.md) (gaps and risks) and
[REMOTE-ACCESS.md](REMOTE-ACCESS.md) (the server) — duplicating it here would
mean two versions to keep honest, and one of them would be wrong.

Last reviewed: **2026-08-30**

---

## Needs you at the machine

Nothing else can do these, and both matter more than they look.

- [ ] **BIOS: enable "Restore on AC Power Loss"** (sometimes *AC Recovery*, *After
      Power Failure*). Without it a blackout ends with the server off and staying
      off. This actually happened: the machine hibernated on 2026-08-26 21:36 UTC
      and did not come back until someone pressed the button on 2026-08-28 22:51
      — **the app was down for 49 hours**.
      → [OPERATIONS.md gap 4](OPERATIONS.md), [REMOTE-ACCESS.md](REMOTE-ACCESS.md)
- [x] ~~Set `CriticalPowerAction=PowerOff`~~ — done 2026-08-30. The other half of
      the same fix; on its own it does not recover the machine, it just leaves it
      in a state the BIOS setting can boot from.
- [ ] **Plug in the backup drive.** Prefer a small external SSD over a thumb
      drive — thumb drives fail silently under nightly writes, which is the worst
      way for a backup target to fail.
      → [OPERATIONS.md gap 2](OPERATIONS.md)

## Backups — now overdue

Production holds SSS numbers, TINs, salaries, lease terms and permit records.
Every copy is still on the same disk as the database. OPERATIONS.md said to
revisit this "when real staff data accumulates"; that has happened.

- [ ] **Off-machine copies.** The drive above covers disk failure, not fire,
      theft or flood. Options already weighed in
      [OPERATIONS.md gap 2](OPERATIONS.md): Cloudflare R2, a nightly pull to the
      Mac, or the external drive.
- [ ] **Refuse to run when the target is not mounted.** If the drive is absent the
      backup script writes to the mountpoint *directory* on the root disk, reports
      success, and silently backs up to the disk it is meant to protect. The
      commonest way a USB backup setup fails, and it fails invisibly.
- [ ] **Encrypt before it leaves the server.** The dump carries password hashes and
      employee records. `gpg` is already installed.

## Correctness

- [x] ~~A finalised report's figures are not actually frozen~~ — done 2026-09-01.
      Inbound transfers are snapshotted at finalisation, existing reports
      backfilled, and the characterisation test replaced with five asserting the
      correct behaviour. → [OPERATIONS.md gap 0](OPERATIONS.md)


## Before this grows much further

- [x] ~~CI has no typecheck gate~~ — done 2026-08-30. A `typecheck` job gates
      `build-and-push`. Note the proposed one-liner was not enough: shared must be
      built and the Prisma client generated first, or the gate fails on every run
      for reasons unrelated to the code. → [OPERATIONS.md gap 3](OPERATIONS.md)
- [x] ~~No automated tests~~ — started 2026-08-30. 84 tests over the arithmetic
      that costs money, gated in CI, and checked by mutation rather than by
      watching them pass. → [OPERATIONS.md gap 5](OPERATIONS.md)
- [x] ~~Tests for anything needing a database~~ — done 2026-08-31. 35 integration
      tests against a real Postgres, with a service container in CI: permission
      gating, the DSIR guards, date round-trips and the seed's promotion guard.
      119 tests in total. → [OPERATIONS.md gap 5](OPERATIONS.md)
- [x] ~~Browser tests~~ — done 2026-08-31. 9 Playwright tests in their own CI
      job, targeting behaviour that only exists in a browser: expression entry,
      the session refresh after a rename, and the UI half of permission gating.
      128 tests in total. → [OPERATIONS.md gap 5](OPERATIONS.md)
- [ ] **Phase 4 — audit logging.** Now that salaries, government IDs and lease
      terms are stored, "who changed this and who looked at it" stops being
      optional. → [ROADMAP.md Phase 4](ROADMAP.md)

## Features

### Phase 5 — HR
- [x] **5a — the 201 file.** Live. Personal details, government IDs, employment
      dates, effective-dated pay, at `/admin/employees/:id`.
- [x] **5f — branch records.** Live. Lease, effective-dated rent, permits with
      expiry warnings, and utility accounts with bills, unpaid warnings and
      year-on-year consumption, at `/admin/branches/:id`.
- [ ] **5b — the charges and shortages ledger.** The one that makes this worth
      building rather than buying: DSIR charges and cash shortages already name
      the employee and already end at payroll, and nothing yet consumes them.
      Includes the review step — approve, waive or spread a deduction — which is
      where wrong deductions get caught.
- [ ] **5c — attendance.** Days present, absences, leaves. Not biometrics.
- [ ] **5d — payroll runs.** Payslips and 13th month pay. Contribution tables must
      be effective-dated **data**, never constants in code.
- [ ] **5e — documents.** Certificate of Employment, payslip PDFs, leave balances.
- [ ] **Document scans for permits and contracts.** `contractFile` and
      `documentFile` columns already exist unused, so this is additive. Deliberately
      waiting on the backup drive — scanned government documents should not live
      in only one place.

### Later
- [ ] Branch performance dashboard
- [ ] Inventory tracking
- [ ] Order management
- [ ] Portainer for server management

- [ ] **An API test fails about 1 run in 8, and I could not reproduce it.**
      Seen twice on 2026-09-01, both times on the first `pnpm -r test` run
      immediately after the test database had been created or migrated in the
      same command — which points at a startup race rather than a logic bug. Six
      consecutive runs afterwards were clean, and CI has never shown it. Vitest
      does not name the test in the summary line, so the next step is
      `--reporter=verbose` in CI to capture which one when it next happens.

## Small

- [x] ~~`@types/express@^5` paired with `express@^4`~~ — done 2026-09-01. Types
      aligned to ^4, with a pnpm override because `@types/multer` forced v5 back
      into the tree. → [OPERATIONS.md gap 6](OPERATIONS.md)
- [x] ~~Server `.env` values are unquoted~~ — done 2026-08-30. All ten values
      single-quoted, verified byte-identical through `docker compose config`
      before and after. The advice in OPERATIONS.md was itself wrong and has been
      corrected: Compose *does* interpolate, and double quotes do not protect.
      → [OPERATIONS.md gap 7](OPERATIONS.md)
- [ ] **`.env` is not backed up.** Backups cover the database and product images
      only, so a disk failure loses the tunnel token, the Cloudflare API token and
      `JWT_SECRET`. All are regenerable, but not quickly and not from memory. It
      holds every secret, so it must be encrypted wherever it lands.
- [x] ~~Frontend bundle is not code-split~~ — done 2026-09-01. First paint 288 →
      268 KB on the wire (modest), but a deploy now re-downloads ~11 KB instead
      of 288 KB on every tablet, which was the point.
      → [OPERATIONS.md gap 8](OPERATIONS.md)

## Decided, not doing

Kept so they are not re-proposed.

- **Tailscale for server access** — considered 2026-08-26 and deferred; the SSH
  port forward stays. Password authentication *is* off. The plan is preserved in
  [REMOTE-ACCESS.md](REMOTE-ACCESS.md) if it is picked up again.
- **Full BIR withholding computation** — record what was withheld, do not compute
  it. High stakes, changes often, penalties land on the business.
- **Biometric / DTR hardware** — same reason tablets are not in branches yet.
- **Per-branch price overrides** — add a `ProductBranchPrice` table only if a
  branch ever genuinely needs its own price.
- **Effective-dated product prices** — prices change once or twice a year, so the
  exposure is a handful of branch-days per change. Process rule instead: finish
  encoding outstanding forms before applying a price change.
  → [DOMAIN.md](DOMAIN.md)
