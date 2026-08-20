# Tech Stack

Every choice below was made deliberately. This document records the reasoning so future sessions don't relitigate these decisions.

---

## Monorepo: pnpm workspaces

**Why pnpm over npm workspaces:** Faster installs, symlink-based node_modules (disk efficient), strict dependency isolation by default.

**Why not Turborepo:** Adds build caching and task orchestration, but the complexity is overkill at this stage. Add it later if build times become painful.

**Why not Nx:** Too opinionated, significant learning curve, better suited for large enterprise monorepos.

---

## Backend: Express.js + TypeScript

**Why Express:** Minimal, unopinionated, massive ecosystem. We control exactly what gets added. Perfect for iterating quickly on a custom bakery domain.

**Why not Fastify:** Faster throughput, but Express wins on ecosystem familiarity. Can migrate later if performance becomes a concern.

**Why not NestJS:** NestJS is a full framework with its own conventions (decorators, modules, DI). Excellent for large teams but adds significant boilerplate for a project of this size.

---

## ORM: Prisma

**Why Prisma:** Schema-first workflow — write `schema.prisma`, get auto-generated TypeScript types + migration SQL + a type-safe query client. Excellent for a schema that will evolve rapidly (roles, branches, audit logs, etc.).

**Why not Drizzle:** Great choice too, but Prisma's migration system and codegen are more beginner-friendly and reduce manual work.

**Why not raw SQL (pg/postgres.js):** Maximum control but requires manual type definitions and migration management. Not worth the overhead at this stage.

---

## Auth: JWT (jsonwebtoken + bcryptjs)

**Why JWT:** Stateless — the server doesn't need to store sessions. Works across multiple services if we ever split the API. Easy to extend to mobile clients later.

**Why not sessions + Redis:** Requires a Redis instance. Sessions are easier to forcibly revoke (useful if an account is compromised), but adds infrastructure complexity we don't need yet. Revisit if forced logout becomes a requirement.

**Why bcryptjs over argon2:** bcryptjs is pure JavaScript (no native bindings), easier to run in Alpine Docker containers. Argon2 is more modern but requires build tools.

---

## Validation: Zod

**Why Zod:** Schema-first runtime validation with automatic TypeScript type inference. Define once, validate at runtime + get compile-time types. No code duplication.

**Why not Joi/Yup:** Zod has better TypeScript integration and is now the community standard for TS projects.

---

## Database: PostgreSQL 16 (Alpine)

**Why PostgreSQL:** ACID compliance, excellent JSON support (for future audit log flexibility), mature ecosystem, Prisma first-class support.

**Why Alpine image:** Smaller container footprint (~80MB vs ~350MB for standard).

**Why not MySQL:** PostgreSQL is more feature-rich (better JSON, full-text search, etc.) and is what Prisma is most tested against.

**Why not SQLite:** Not suitable for multi-user concurrent writes across 10 branches.

---

## Frontend: React + Vite + TypeScript

**Why React:** Largest ecosystem, team familiarity, massive component library support.

**Why Vite:** Fastest dev server (ESM-native HMR), excellent TypeScript support, simple config.

**Why not Next.js:** SSR/SSG features aren't needed yet. The app is behind a login wall — all pages are private. Adding Next.js for a dashboard adds complexity without benefit at this stage.

**Why not Create React App:** Deprecated, slow, unmaintained.

---

## UI Components: Mantine

**Why Mantine:** Phase 2+ is almost entirely admin CRUD — data tables, forms, modals, multi-selects, notifications. Mantine ships all of them as working components, so no UI primitives have to be written by hand.

The deciding factor was `mantine-form-zod-resolver`: forms validate against the *same* Zod schema the API validates with. `loginSchema` lives in `packages/shared/src/schemas/` and is imported by both sides, so client and server cannot drift on what valid input means. That is the payoff the monorepo was set up for.

Dark mode, spacing, and typography defaults come for free — "modern" costs no design time.

**Why not Tailwind + shadcn/ui:** Components would be copied into the repo and fully owned, which fits our "control what gets added" bias. But data tables (TanStack Table) and forms (react-hook-form) would have to be assembled by hand, and the Zod-schema reuse would need wiring up manually. Revisit if a bespoke visual identity ever matters more than shipping screens.

**Why not plain CSS Modules:** Cheapest to start, but every table, modal, and select would be built from scratch.

**Tradeoff accepted:** A runtime dependency with its own theming system, and the app will look like a Mantine app.

**Required React 19** — Mantine 9 peer-depends on it. The upgrade from 18 was trivial at 3 pages; deferring it would only have made it harder.

---

## Containers: Docker + Docker Compose

**Why Docker:** Consistent environments from local → CI → production. Eliminates "works on my machine" issues.

**Why Docker Compose:** Simple multi-service orchestration. Sufficient for a single-server deployment. Add Kubernetes later only if horizontal scaling becomes necessary.

---

## Reverse Proxy: Traefik v3

**Why Traefik:** Container-native — reads Docker labels for routing config. No manual nginx config files to maintain. Native Let's Encrypt integration for when a domain is added.

**Why not Nginx:** Requires manual config files and reload on changes. Traefik auto-discovers new containers via Docker labels.

**Why not Caddy:** Similar to Traefik but less Docker-native. Traefik is better suited for container orchestration.

---

## Container Registry: GHCR (GitHub Container Registry)

**Why GHCR:** Free for public repos, tightly integrated with GitHub Actions (uses `GITHUB_TOKEN` — no extra credentials). Images at `ghcr.io/junparajes/otomate-api`.

**Why not Docker Hub:** Rate limits on pulls, requires separate credentials.

---

## CI/CD: GitHub Actions

**Why GitHub Actions:** Already using GitHub for source control. Free for public repos. Native GHCR integration.

**Why not GitLab CI / CircleCI:** No strong reason to introduce a second platform.

---

## Server: Self-hosted Ubuntu 26.04

**Why self-hosted:** Cost — a VPS for this workload would cost $10–20/month. Old laptop repurposed as a server is free.

**Tradeoffs:** No SLA, dependent on home internet uptime, manual OS maintenance. Acceptable for a bakery internal tool.
