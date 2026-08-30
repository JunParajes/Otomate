# Otomate — Bakery Management System

## What is this?
A multi-branch bakery management web app serving 10 branches. Built as a monorepo with a React frontend, Express.js API, and PostgreSQL database. Deployed on a self-hosted Ubuntu server via Docker + Traefik.

## Monorepo Layout
```
Otomate/
├── apps/
│   ├── api/          # Express.js REST API (port 3001)
│   └── web/          # React + Vite frontend (port 5173 in dev)
├── packages/
│   └── shared/       # Shared TypeScript types (User, Role, ApiResponse, etc.)
├── docs/             # Architecture, techstack, roadmap, conventions
├── .github/workflows/ # GitHub Actions CI/CD
├── docker-compose.yml          # Local development
└── docker-compose.prod.yml     # Production (pulls from GHCR)
```

## How to Run

### Local Development
```bash
cp .env.example .env          # fill in values
docker compose up             # starts postgres + api + web
```
- Frontend: http://localhost:5173
- API: http://localhost:3001
- API health: http://localhost:3001/health

### First-time DB setup
```bash
docker compose exec api npx prisma migrate dev
docker compose exec api npx prisma db seed
# The seed creates an admin account using SEED_ADMIN_PASSWORD from the environment.
# If that is unset it uses a placeholder and flags the account mustChangePassword,
# forcing a change at first login. Never document a real password here — this repo
# is public, and the app is reachable at https://otomate.uk.
```

### Production (on server)
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Current Phase
**Phase 5 — HR** (in progress). Phases 1–3 are done; Phase 4 (auditing) is not started.
**[docs/TODO.md](docs/TODO.md) is the single list of what is actually outstanding** — start there.
See [docs/ROADMAP.md](docs/ROADMAP.md) for the phase breakdown and the reasoning behind each.
Known gaps and deferred operational work are tracked in [docs/OPERATIONS.md](docs/OPERATIONS.md) — check it before assuming something is set up.
**[docs/DOMAIN.md](docs/DOMAIN.md) describes how the bakery actually operates** (the DSIR stock-reconciliation process). Read it before touching anything to do with stock, sales or prices — several rules there look like quirks but are deliberate anti-theft controls.

## Key Architectural Decisions
- **pnpm workspaces** — monorepo without Turborepo overhead
- **Prisma** — schema-first ORM; migrations tracked in git
- **JWT auth** — stateless, no Redis required; tokens stored in localStorage
- **Mantine (React 19)** — component library for admin UI; forms validate against shared Zod schemas
- **`packages/shared` is dual-built (CJS + ESM)** — the API requires CJS, Vite needs ESM
- **Traefik v3** — routes `/api/*` → Express, `/*` → React/Nginx
- **GHCR** — images at `ghcr.io/junparajes/otomate-api` and `ghcr.io/junparajes/otomate-web`
- **Cloudflare Tunnel, not port forwarding** — https://otomate.uk is served through an
  outbound tunnel, so no inbound port is open for the app and TLS terminates at
  Cloudflare. Let's Encrypt labels on Traefik are therefore *not* needed.

## Things to Avoid
- Never commit `.env` — use `.env.example` as a template
- Never use `any` in TypeScript — use `unknown` + Zod validation at boundaries
- Don't add features outside the current phase without updating ROADMAP.md
- Don't skip Prisma migrations — always run `prisma migrate dev` after schema changes, and commit the generated `prisma/migrations/` folder
- Never use `prisma db push` against production — it drifts the schema out of migration history

## Useful Commands
```bash
# Install all workspace deps
pnpm install

# Run api in dev mode (outside docker)
pnpm --filter api dev

# Run web in dev mode (outside docker)
pnpm --filter web dev

# Prisma
pnpm --filter api exec prisma migrate dev --name <change>   # create + apply a migration
pnpm --filter api exec prisma migrate deploy                # apply pending migrations (prod)
pnpm --filter api exec prisma migrate status                # what's applied vs pending
pnpm --filter api exec prisma studio
pnpm --filter api exec prisma db seed

# Type check all packages
pnpm -r tsc --noEmit

# Docker
docker compose up --build        # rebuild images
docker compose down -v           # stop + remove volumes
```

## GitHub & Deployment
- Repo: https://github.com/JunParajes/Otomate
- Push to `main` → GitHub Actions builds images → pushes to GHCR → SSHes into server → pulls + restarts
- Server: `<SERVER_USER>@server.otomate.uk -p 2222` (Ubuntu 26.04) — **the SSH port is 2222**,
  not 22. Other values are in your local notes/password manager. See [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md).
- Required GitHub secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_PORT`, `SERVER_SSH_KEY`
