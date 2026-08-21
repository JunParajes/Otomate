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
├── traefik/          # Traefik reverse proxy config
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
# Default admin: admin@otomate.local / admin123
```

### Production (on server)
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Current Phase
**Phase 1 — Boilerplate** (in progress)
See [docs/ROADMAP.md](docs/ROADMAP.md) for full phase breakdown.
Known gaps and deferred operational work are tracked in [docs/OPERATIONS.md](docs/OPERATIONS.md) — check it before assuming something is set up.

## Key Architectural Decisions
- **pnpm workspaces** — monorepo without Turborepo overhead
- **Prisma** — schema-first ORM; migrations tracked in git
- **JWT auth** — stateless, no Redis required; tokens stored in localStorage
- **Mantine (React 19)** — component library for admin UI; forms validate against shared Zod schemas
- **`packages/shared` is dual-built (CJS + ESM)** — the API requires CJS, Vite needs ESM
- **Traefik v3** — routes `/api/*` → Express, `/*` → React/Nginx
- **GHCR** — images at `ghcr.io/junparajes/otomate-api` and `ghcr.io/junparajes/otomate-web`
- **IP-only** — no domain/TLS yet; add Traefik Let's Encrypt labels when domain is ready

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
- Server: `<SERVER_USER>@<SERVER_LAN_IP>` (Ubuntu 26.04) — actual values in your local notes/password manager
- Required GitHub secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_PORT`, `SERVER_SSH_KEY`
