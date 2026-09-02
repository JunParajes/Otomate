# Roadmap

## Phase 0 — Documentation ✅
- [x] CLAUDE.md (session context for Claude Code)
- [x] docs/ARCHITECTURE.md
- [x] docs/TECHSTACK.md
- [x] docs/ROADMAP.md
- [x] docs/CONVENTIONS.md
- [x] Server Docker install (Ubuntu 26.04, Docker 29.7.2)
- [x] GitHub repo + GHCR setup + SSH deploy key

---

## Phase 1 — Boilerplate + Infrastructure ✅
- [x] Monorepo scaffold (pnpm workspaces, TypeScript, .env)
- [x] packages/shared (shared types)
- [x] apps/api (Express + Prisma + JWT auth)
- [x] apps/web (React + Vite + login + dashboard)
- [x] Dockerfiles (single-stage api, multi-stage web with nginx)
- [x] docker-compose.yml (local dev with hot reload)
- [x] docker-compose.prod.yml (production with Traefik)
- [x] Traefik v3 (routes /api|/health → api, / → frontend)
- [x] GitHub Actions CI/CD (build → GHCR → SSH deploy → migrate → restart)
- [x] First production deploy to server (reachable over LAN and internet)
- [x] Public access — via an outbound **Cloudflare Tunnel**, not a port forward.
      Port 80 forwarding was removed on purpose: the tunnel needs no inbound port,
      so there is nothing on 80/443 to scan. See [DOMAIN-SETUP.md](DOMAIN-SETUP.md).
- [x] Proper Prisma migrations — `0_init` baseline committed and applied to production on 2026-08-20; `prisma migrate deploy` now reports "No pending migrations to apply"

---

## Phase 2 — Users / Roles / Permissions
> Full RBAC system for the bakery org structure.

- [x] Role management UI (create, edit, delete; system roles protected)
- [x] Permission assignment to roles (catalog grouped by category)
- [x] User management UI (create, edit, deactivate — never hard delete)
- [x] Branch management UI + branch assignment per user
- [x] Password change / admin reset flow (`mustChangePassword` forces a change at next sign-in)
- [x] Protected routes by permission on frontend (links hidden, not just blocked)
- [x] Permission catalog defined in `packages/shared/src/permissions.ts` and synced by the seed
- [x] Permissions re-read from the DB per request — role changes and deactivations apply immediately
- [x] Guardrails: no self-deactivate/self-demote, cannot remove the last Super Admin,
      cannot grant permissions you do not hold, role delete requires reassignment
- [ ] Seed bakery roles (`manager`, `frontliner`, `baker`) — now created through the GUI
      rather than seeded; only `super_admin` is seeded

---

## Phase 3 — Product Catalogue
> Products, categories, prices and photos, managed through the GUI.

- [x] Category CRUD (create, edit, delete, deactivate; delete guarded by product count)
- [x] Product CRUD with SKU, description, unit of sale, sort order
- [x] Prices stored as **integer centavos** (PHP) — never floating point
- [x] Cost price + margin, gated behind its own `products:cost` permission
- [x] Product image upload — resized to 1200px WebP, EXIF-rotated, stored on the
      `product-images` Docker volume and served unauthenticated
- [x] Search and category filter on the products table
- [ ] Per-branch price overrides — deliberately deferred; add a `ProductBranchPrice`
      table if a branch ever needs its own price

---

## Phase 4 — Auditing System
> (Details TBD — user to expand)

- [ ] AuditLog table in Prisma schema
- [ ] Middleware to automatically record create/update/delete events
- [ ] Audit log viewer UI (filterable by user, branch, action, date)
- [ ] Export audit log to CSV

---

## Phase 5 — HR

Employee records beyond a name and a branch, and — the part that is specific to
this business — turning what the DSIR already knows into what payroll needs.

### Why this belongs here rather than in an off-the-shelf HR package

Otomate already captures two streams of money owed by staff, and
[DOMAIN.md](DOMAIN.md) says both end at payroll:

| Stream | Origin | DOMAIN.md |
|---|---|---|
| **Charges** | goods taken or damaged by staff | *"none — recovered via payroll"*, at full selling price |
| **Shortages** | cash variance on a finalised DSIR | *"deducted from employees' pay"* |

The capture side is done — charges carry the employee, shortages are derived per
report. Nothing consumes either. The old process failed exactly here: *"Charges
have no name attached… the join is manual and memory-dependent. Any charge that
falls through is money the business meant to recover and simply doesn't."*

### 5a. The 201 file — DONE

- [x] Personal: birth date, birth place, gender, civil status, religion, email,
      height and weight, educational attainment, address, emergency contact,
      free-text remarks
- [x] Contact numbers as a **list**, each with its network — dual SIM is normal,
      and which network a number is on decides who can reach someone when one
      has no signal
- [x] Government IDs: SSS, PhilHealth, Pag-IBIG, TIN
- [x] Employment: date hired, employment type, probation end, **probation
      extension** (a separate date, so the original deadline stays on the
      record), regularisation, separation date and reason
- [x] Document checks — confidentiality agreement, authority to deduct, birth
      certificate, marriage contract — each held as the **date** signed or
      received rather than a tick
- [x] Pay: basic and allowance, as **effective-dated history** (below)
- [x] Payout method and account
- [x] Permission split so pay is not visible to everyone with `employees:read`

Age and length of service are **derived from the dates, never stored** — a
stored age is wrong the day after it is typed. Height is whole centimetres and
weight is grams, following the same integer-units rule as money: 62.5 kg is
exact and no float reaches the database.

Three decisions that are hard to reverse later:

1. **Salary is a history table, not a column.** A raise in March must not rewrite
   January's payslip. This is the same rule as `unitPriceCents` snapshotted onto
   `DsirLine`, for the same reason — a rate that moves retroactively silently
   falsifies every past figure derived from it.
2. **Pay and government IDs get their own permissions.** A branch manager should
   be able to see who works for them without seeing salaries. Hence
   `hr:read` / `hr:write` for the 201 file and `hr:salary:read` /
   `hr:salary:write` for pay.
3. **Probation end is an alert, not a stored date.** Probation caps at six months
   under the Labor Code, and an employee not acted on by then becomes regular by
   operation of law. A date nobody looks at is how that happens by accident.

Lives at `/admin/employees/:id`. It shipped as a modal and was converted to a
route — a record this size needs to be linkable, printable and closable with the
back gesture, and 5b–5e all hang off it.

### 5b. Close the money loop

- [ ] Per-employee ledger of charges and shortages, by pay period
- [ ] Review step before deduction — approve, waive, or spread over periods, with
      a reason and an audit trail
- [ ] Running balance for a charge being paid off gradually

DOMAIN.md: *"a shortage can come from theft or from a counting mistake and the
sheet cannot tell them apart… Better data means fewer wrong deductions — good for
staff."* The review step is where that fairness actually happens.

### 5c. Attendance

- [ ] Days present, absences, leaves, marked per branch by a manager

Not biometrics, and not a DTR device — branches are still on paper DSIR forms.
Note the DSIR already names `openedBy`/`closedBy`, which is a weak attendance
signal available for free.

### 5d. Payroll runs

- [ ] Payslip: gross → deductions → net, printable
- [ ] 13th month pay (mandatory, due 24 December, basic salary earned ÷ 12)
- [ ] **Contribution tables as effective-dated data, never constants in code**

SSS, PhilHealth and Pag-IBIG rates change by government circular. Hardcoding them
means a deploy per change and silently wrong deductions until somebody notices.
Whatever rates go in must be checked against the current circular at the time —
not carried over from memory or from this document.

### 5e. Documents

- [ ] Certificate of Employment
- [ ] Payslip PDF
- [ ] Leave balances (Service Incentive Leave: 5 days after one year)
- [ ] BIR 2316 at year end

### 5f. Branch records — DONE

The same shape as the 201 file, for premises rather than people.

- [x] Lease: address, lessor and contact, contract dates, notice period, deposit
      and advance
- [x] Rent as **effective-dated history**, same rule as pay — leases escalate
      annually and a rise must not rewrite last year's costs
- [x] Permits as a table, not columns: Mayor's, Barangay, BIR, Sanitary, Fire
      Safety, Occupancy, Zoning, Environmental, and OTHER with its own label
- [x] Expiry warnings at 60 days, and a per-branch badge on the branch list
- [x] `branches:permits:*` split from `branches:lease:*` — a manager sees what
      needs renewing without seeing what the branch pays
- [x] Utility accounts and bills: electricity, water, internet. A ledger, not an
      effective-dated figure — each bill is its own event with a period, amount
      and due date. Unpaid and overdue warnings, and meter readings compared with
      the same month a year earlier
- [x] `branches:utilities:*` as a third pair — a spike in electricity or an
      unpaid bill is a manager's problem; the rent is not

Sixty days rather than the thirty used for probation: renewals mean queuing at a
city office, several are prerequisites for each other (a lapsed Barangay
Clearance or Fire Safety certificate blocks the Mayor's Permit), and every
business in Davao renews in January.

Not built: document scans. The columns `contractFile` and `documentFile` exist
unused so adding uploads is additive. Deferred deliberately — backups are still
on the same disk as the database, and scanned government documents and lease
contracts are exactly what should not live in only one place.

### Deliberately out of scope for now

- **Full BIR withholding computation.** High stakes, frequent changes, penalties
  land on the business. Record what was withheld; do not compute it until the
  rest is stable and someone can check it against a real payslip.
- **Biometric / DTR hardware.** Same reason tablets are not in branches yet.

### What this pulls in

- **Phase 4 audit logging stops being optional.** Once salaries are stored, "who
  changed this figure, and who looked at it" is the whole point.
- **Off-machine backups become due** — gap 2 in [OPERATIONS.md](OPERATIONS.md)
  says to revisit "when real staff data accumulates", and this is that. Under the
  Data Privacy Act these are personal records, so the dump should be encrypted
  before it leaves the server.

---

## Phase 6+ — Future Features
> To be defined as the product evolves.

- [ ] Branch performance dashboard / reports
- [ ] Inventory tracking
- [ ] Order management
- [ ] Mobile-responsive UI improvements
- [x] Domain + HTTPS — done via Cloudflare Tunnel rather than Let's Encrypt
- [ ] Portainer for server management UI

---

## Deployment Targets

| Environment | URL | Notes |
|-------------|-----|-------|
| Local dev | http://localhost:5173 | Docker Compose, hot reload |
| Production | https://otomate.uk | Cloudflare Tunnel → Traefik → api/web. No inbound port. |
| Server admin | `ssh <user>@server.otomate.uk -p 2222` | DDNS-tracked public IP; see [REMOTE-ACCESS.md](REMOTE-ACCESS.md) |
