# Otomate

Bakery management system for a small multi-branch bakery chain — user and role
administration, a shared product catalogue, and (in progress) daily sales and
inventory reporting.

Monorepo: React + Vite frontend, Express + Prisma API, PostgreSQL, deployed with
Docker and Traefik.

## Documentation

| Doc | What it covers |
|-----|----------------|
| [CLAUDE.md](CLAUDE.md) | Project overview, how to run it, key decisions |
| [docs/DOMAIN.md](docs/DOMAIN.md) | **How the business actually works** — read before touching stock, sales or prices |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Services, routing, database schema |
| [docs/TECHSTACK.md](docs/TECHSTACK.md) | What was chosen, and what was rejected, with reasons |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and progress |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code style, API shape, naming |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Known gaps and deferred work |
| [docs/DOMAIN-SETUP.md](docs/DOMAIN-SETUP.md) | Domain, HTTPS and the dynamic IP |
| [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) | What is backed up, and how to get it back |

## Quick start

```bash
cp .env.example .env      # fill in values
docker compose up         # postgres + api + web
```

Frontend on `:5173`, API on `:3001`. First-time database setup and the full
command reference are in [CLAUDE.md](CLAUDE.md).
