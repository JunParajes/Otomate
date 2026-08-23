# Architecture

## Service Map

```
[Browser]
    │
    ▼
[Traefik :80]  ←── reverse proxy
    │
    ├── PathPrefix(`/api`) ──► [api: Express.js :3001]
    │                                │
    │                                ▼
    │                         [postgres :5432]
    │
    └── PathPrefix(`/`)  ──► [web: React/Nginx :80]
```

## Monorepo Structure

```
Otomate/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/       # Express route handlers
│   │   │   ├── middleware/   # auth (JWT), rbac (permissions)
│   │   │   ├── prisma/       # Prisma client singleton
│   │   │   └── index.ts      # App entry point
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   └── Dockerfile
│   └── web/
│       ├── src/
│       │   ├── pages/        # Login, Dashboard, NotFound
│       │   ├── components/   # Shared UI components
│       │   ├── lib/          # axios instance, auth helpers
│       │   └── main.tsx
│       └── Dockerfile
├── packages/
│   └── shared/
│       └── src/
│           ├── types/        # User, Role, Branch, Permission interfaces
│           └── index.ts
└── docker-compose.prod.yml   # Traefik is configured here, via CLI flags
```

## Docker Networking

All services share a Docker bridge network named `otomate-net`.

| Service    | Internal host | Internal port | Exposed (dev) |
|------------|---------------|---------------|---------------|
| traefik    | traefik       | 80            | 80            |
| api        | api           | 3001          | 3001          |
| web        | web           | 80            | 5173          |
| postgres   | postgres      | 5432          | 5432          |

In production, only port 80 on Traefik is exposed to the host. Nothing else is publicly accessible.

## API Base Routes

| Method | Path              | Auth | Description              |
|--------|-------------------|------|--------------------------|
| GET    | /health           | No   | Docker/Traefik healthcheck |
| POST   | /api/auth/login   | No   | Returns JWT access token |
| GET    | /api/users        | Yes  | List users (admin only)  |
| GET    | /api/users/me     | Yes  | Current user profile     |

## Database Schema (ER Overview)

```
Branch ──< User >── Role ──< Permission
                (many-to-many via _PermissionToRole)
```

```
User
 ├── id         (cuid)
 ├── email      (unique)
 ├── password   (bcrypt)
 ├── name
 ├── isActive
 ├── roleId  ──► Role.id
 └── branchId ──► Branch.id (nullable)

Role
 ├── id
 ├── name       (unique: "admin" | "branch_manager" | "staff")
 └── permissions[] ──► Permission[]

Permission
 ├── id
 └── name       (e.g. "users:read", "users:write", "reports:read")

Branch
 ├── id
 └── name
```

## Auth Flow (JWT)

```
1. POST /api/auth/login { email, password }
      │
      ▼
2. Server verifies password (bcrypt)
      │
      ▼
3. Server signs JWT { userId, roleId, permissions[] }
   with JWT_SECRET (exp: 7d)
      │
      ▼
4. Client stores token in localStorage
      │
      ▼
5. Client sends: Authorization: Bearer <token>
      │
      ▼
6. auth middleware verifies + attaches req.user
      │
      ▼
7. rbac middleware checks req.user.permissions
```

## PWA / offline behaviour

The web app is installable: `vite-plugin-pwa` (Workbox, `generateSW`) emits a
manifest and a service worker at build time. Installing it to a tablet's home
screen needs no app store, which is the intended path for branch-side capture
later.

### The API is never cached — deliberately

The service worker precaches the app shell and runtime-caches **product images
only**. Nothing under `/api` is cached, and no rule matches it, so those
requests go straight to the network.

This is a domain rule, not a performance choice. Prices here are the
authoritative figure the day's sales are derived from, and a shortage is
deducted from an employee's wages (see [DOMAIN.md](DOMAIN.md)). A stale price
served from a cache would take money off someone's pay. **The correct rule is
no rule.**

Product images are the one exception, and only because their filenames are
content-unique uuids — the URL changes when the image does, so a cached file
cannot be stale.

Offline, the shell loads and API calls fail with the existing "Could not reach
the server" message. That is the honest behaviour: entry cannot be queued
offline, and pretending otherwise would risk losing a form.

### Caching rules that are easy to get wrong

| File | Cache | Why |
|------|-------|-----|
| `/assets/*` | 1 year, immutable | Vite fingerprints these |
| `sw.js`, `registerSW.js`, `manifest.webmanifest`, `index.html` | `no-cache` | see below |
| icons, other `public/` files | 7 days | names are stable across builds, so immutable would strand a redesign for a year |

`sw.js` is the trap. It ends in `.js`, so a blanket `expires 1y; immutable` rule
catches it — and a service worker that can never update leaves every installed
client frozen on whatever build it first saw, with no route back except clearing
site data. `index.html` matters for the same reason: it names the fingerprinted
assets.

nginx also has no MIME type for `.webmanifest` (checked on 1.31.4), so it must be
declared or the manifest is served as `application/octet-stream` and rejected.

### Cloudflare rewrites the browser TTL

The edge serves `sw.js` with `cache-control: max-age=14400` regardless of the
origin's `no-cache`, because `.js` is on Cloudflare's default cached-extension
list. Measured, this does **not** stop updates reaching clients:

- `cf-cache-status: REVALIDATED`, and the edge ETag matches the origin's — the
  edge revalidates rather than serving stale bytes.
- The registration uses the default `updateViaCache: 'imports'`, so the browser
  bypasses its own HTTP cache when fetching `sw.js` to check for updates.
- The one file that *does* go through the HTTP cache is the `importScripts`
  target, and that is content-hashed (`workbox-<hash>.js`), so a new build
  imports a new name.

A Cloudflare cache rule bypassing `/sw.js` would tidy the header up, but nothing
depends on it.

## Deploys (zero downtime)

`docker compose up -d` stops the old container before the new one is ready, so
the site returned Traefik 404s for ~15s on every deploy. Measured against a
replica of this stack, that was **586 x 404 and 6 x 502 out of ~1000 requests**.

`scripts/rollout.sh` replaces that for `api` and `web`: start the new container
alongside the old, wait for Docker to report it healthy, then remove the old one.
If the replacement never turns healthy the rollout **aborts and leaves the
previous version serving** — a bad image can no longer take the site down.

The infrastructure services (postgres, traefik, cloudflared, ddns) are still
brought up the ordinary way. They change rarely, and recreating Traefik is an
outage whatever you do.

### Why it works

Traefik's Docker provider only creates a server for a container once Docker
reports it **healthy** — verified against traefik:v3 for both the `unhealthy`
and the `starting` states. So the replacement receives no traffic until it is
ready, and the old container serves throughout.

Two requirements follow, and breaking either silently breaks the rollout:

- **Every rolled service needs a HEALTHCHECK.** Without one there is nothing to
  wait for; `rollout.sh` says so rather than pretending. Both Dockerfiles define
  one, at a 5s interval — it was 30s, which made a rollout wait half a minute
  for a container that was ready in seconds.
- **Rolled services must publish no host ports.** Two containers cannot bind the
  same port. Only Traefik publishes here.

### The last few requests

After the new container is healthy, Traefik keeps the outgoing one in its pool
for a few hundred milliseconds after it stops, and requests dispatched there
fail. The two services handle it differently:

- **web** has a Traefik `retry` middleware, which re-sends to the replacement.
  Measured: this takes a web rollout from ~6 failed requests to zero. Safe here
  because the frontend serves static GETs.
- **api** deliberately has **no** retry. Retrying a request the server already
  processed would save a DSIR twice. Instead it handles `SIGTERM`: it stops
  accepting connections and lets in-flight requests finish, so a save in
  progress completes rather than being cut. A GET-only retry router was tried
  and made no measurable difference, so it was left out.

An api rollout therefore still fails roughly **2-3 requests out of ~1300** at
33 req/s (0.18%) — a window of a few hundred ms. With one encoder that is
usually zero requests, and any that do fail surface as a visible error to retry,
not as lost data.

### A deploy that changes Traefik labels still costs downtime

Both generations exist at once during a rollout, and both declare the same
Traefik router. If their labels **differ**, Traefik logs

```
ERR HTTP router defined multiple times with different configurations
```

and disables that router for the whole overlap — so the site returns 404 even
though a healthy container is serving. This was measured, not theorised: the
deploy that introduced this rollout also added the `retry-frontend` labels, and
produced a 6-second 404 window while old and new disagreed.

Ordinary deploys are unaffected, because both generations carry identical
labels. But **when you change a Traefik label, expect one deploy's worth of
downtime**, and prefer to ship label changes on their own rather than alongside
something urgent.

### Migrations

Migrations still run *before* the rollout, so old and new API containers briefly
share a schema. Prefer additive migrations; a destructive one can break the
outgoing container during the overlap.

## Environment Variables

| Variable       | Service | Description                        |
|----------------|---------|------------------------------------|
| DATABASE_URL   | api     | PostgreSQL connection string        |
| JWT_SECRET     | api     | Secret for signing JWT tokens       |
| API_PORT       | api     | Port Express listens on (3001)      |
| VITE_API_URL   | web     | API base URL seen by the browser    |
| POSTGRES_USER  | postgres| DB superuser                        |
| POSTGRES_PASSWORD | postgres | DB password                     |
| POSTGRES_DB    | postgres| DB name                             |
