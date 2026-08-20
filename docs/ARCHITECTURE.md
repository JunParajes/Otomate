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
└── traefik/
    └── traefik.yml
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
