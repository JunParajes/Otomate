# Conventions

## TypeScript

- **Strict mode always** — `"strict": true` in all tsconfig files
- **No `any`** — use `unknown` + Zod parsing at system boundaries (API input, external responses)
- **Prefer `type` over `interface`** for object shapes unless extending/implementing
- **Zod schemas** are the single source of truth for runtime-validated types; derive TS types from them with `z.infer<>`

```ts
// Good
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) })
type LoginInput = z.infer<typeof loginSchema>

// Bad
interface LoginInput { email: string; password: string }
```

---

## File & Folder Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | kebab-case | `auth-middleware.ts`, `user-routes.ts` |
| React components | PascalCase | `LoginPage.tsx`, `UserTable.tsx` |
| Component folders | PascalCase | `components/UserTable/` |
| Constants | SCREAMING_SNAKE | `MAX_LOGIN_ATTEMPTS` |
| Functions/variables | camelCase | `getUserById`, `isAuthenticated` |
| DB models (Prisma) | PascalCase singular | `User`, `Role`, `Branch` |

---

## API Response Shape

All API responses use a consistent envelope:

```ts
// Success
{ data: T, error: null }

// Error
{ data: null, error: { message: string, code?: string } }
```

```ts
// Helper in packages/shared
export type ApiResponse<T> = 
  | { data: T; error: null }
  | { data: null; error: { message: string; code?: string } }
```

HTTP status codes:
- `200` — success
- `201` — created
- `400` — validation error
- `401` — unauthenticated
- `403` — unauthorized (authenticated but insufficient permissions)
- `404` — not found
- `500` — internal server error

---

## Environment Variables

- **Format:** `SCREAMING_SNAKE_CASE`
- **Prefix by concern:**
  - `API_*` — Express API settings
  - `DB_*` — not used directly; use `DATABASE_URL` for Prisma
  - `JWT_*` — auth settings
  - `VITE_*` — frontend env vars (Vite requirement for browser exposure)
  - `POSTGRES_*` — PostgreSQL Docker env vars

Never commit `.env`. Always keep `.env.example` up to date.

---

## Git Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

Types:
  feat     — new feature
  fix      — bug fix
  chore    — build, deps, config (no production code change)
  docs     — documentation only
  refactor — code change that neither fixes a bug nor adds a feature
  test     — adding or updating tests
  style    — formatting only (no logic change)

Scope (optional): api, web, shared, docker, ci, db

Examples:
  feat(api): add JWT auth middleware
  fix(web): redirect to login on 401 response
  chore(docker): add healthcheck to api service
  docs: update ROADMAP with Phase 2 tasks
```

---

## Folder Structure Rules

### Backend (`apps/api/src/`)

```
routes/       # One file per resource (auth.ts, users.ts, branches.ts)
middleware/   # Express middleware (auth.ts, rbac.ts, error-handler.ts)
prisma/       # Only the Prisma client singleton (client.ts)
lib/          # Pure utility functions (hash.ts, jwt.ts)
```

- Routes **only** handle HTTP in/out (parse body, call service, send response)
- Business logic lives in `lib/` functions, not in route handlers
- Middleware is composable — stack them with `router.use()`

### Frontend (`apps/web/src/`)

```
pages/        # One file per route (LoginPage.tsx, DashboardPage.tsx)
components/   # Shared/reusable UI components
lib/          # api.ts (axios instance), auth.ts (token helpers)
hooks/        # Custom React hooks (useAuth.ts, useApi.ts)
```

---

## Imports

- Use absolute imports via TypeScript path aliases (`@/components/...`, `@shared/...`)
- Never use relative `../../../` more than 2 levels deep — add a path alias instead
- Import order (enforced by convention, add ESLint later):
  1. Node built-ins
  2. External packages
  3. Internal packages (`@shared/`)
  4. Local files (`@/`, `./`)
