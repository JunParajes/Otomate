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

## Phase 1 — Boilerplate + Infrastructure 🔄 (current)
- [x] Monorepo scaffold (pnpm workspaces, TypeScript, .env)
- [x] packages/shared (shared types)
- [x] apps/api (Express + Prisma + JWT auth)
- [x] apps/web (React + Vite + login + dashboard)
- [x] Dockerfiles (multi-stage, api + web)
- [x] docker-compose.yml (local dev with hot reload)
- [x] docker-compose.prod.yml (production)
- [x] Traefik v3 config (IP-only routing)
- [x] GitHub Actions CI/CD (build → GHCR → SSH deploy)
- [ ] End-to-end local verification
- [ ] First production deploy to server

---

## Phase 2 — Users / Roles / Permissions
> Full RBAC system for the bakery org structure.

- [ ] Role management UI (admin creates/edits roles)
- [ ] Permission assignment to roles
- [ ] User management UI (create, edit, deactivate users)
- [ ] Branch assignment per user
- [ ] Password change / reset flow
- [ ] Protected routes by permission on frontend
- [ ] Seed realistic bakery roles: `admin`, `branch_manager`, `cashier`, `baker`
- [ ] Seed realistic permissions: `users:read`, `users:write`, `reports:read`, etc.

---

## Phase 3 — Auditing System
> (Details TBD — user to expand)

- [ ] AuditLog table in Prisma schema
- [ ] Middleware to automatically record create/update/delete events
- [ ] Audit log viewer UI (filterable by user, branch, action, date)
- [ ] Export audit log to CSV

---

## Phase 4+ — Future Features
> To be defined as the product evolves.

- [ ] Branch performance dashboard / reports
- [ ] Inventory tracking
- [ ] Order management
- [ ] Mobile-responsive UI improvements
- [ ] Domain + HTTPS (Traefik + Let's Encrypt)
- [ ] Portainer for server management UI

---

## Deployment Targets

| Environment | URL | Notes |
|-------------|-----|-------|
| Local dev | http://localhost:5173 | Docker Compose, hot reload |
| Production | http://192.168.1.82 | Ubuntu server, Traefik |
| Production (future) | https://yourdomain.com | When domain is added |
