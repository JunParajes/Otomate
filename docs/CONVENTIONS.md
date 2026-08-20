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

## Styling

- **Mantine components first** — reach for `<Stack>`, `<Group>`, `<Card>` before writing layout CSS
- **No inline `style={{...}}` objects** — use Mantine style props (`mt`, `p`, `c`, `maw`) or CSS Modules for anything they can't express
- **No hardcoded colors** — use theme colors (`c="dimmed"`, `color="red"`) or CSS variables (`var(--mantine-color-body)`) so dark mode keeps working
- **Theme changes go in `apps/web/src/theme.ts`**, never per-component overrides
- Default sizes for inputs and buttons are set globally in the theme — don't pass `size` per component

## Shared Validation Schemas

Zod schemas used by **both** api and web live in `packages/shared/src/schemas/`.

```ts
// packages/shared/src/schemas/auth.ts — one definition
export const loginSchema = z.object({ email: z.email(), password: z.string().min(1) })

// apps/api — server-side validation
loginSchema.safeParse(req.body)

// apps/web — the same object drives the form
useForm({ validate: zodResolver(loginSchema) })
```

`packages/shared` builds to **both CJS and ESM** (`dist/cjs` + `dist/esm`) because the API is CommonJS and Vite needs real ESM to bundle. Adding runtime (non-type) exports to shared requires both builds to stay working — `pnpm --filter web build` is the check that catches it.

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

## .env Gotcha — Never `source` It

Values in `.env` are **not** shell-quoted, so `set -a; . ./.env` makes bash perform
parameter expansion on them. Any `$` in a password propagates into `DATABASE_URL` and
gets expanded — `$@`, `$1`, `$USER` and friends silently collapse to something else,
producing an invalid URL. Prisma then fails with `P1013: invalid port number`, which
points nowhere near the real cause. This has already bitten this project once in
production.

Docker Compose reads `.env` itself **without** expanding, which is why containers
work while a sourcing script fails.

```bash
# WRONG — corrupts DATABASE_URL
set -a; . ./.env; set +a

# RIGHT — pull out only the plain values you need, let Compose handle the rest
POSTGRES_USER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)
```

Also note: `docker compose exec -T` reads stdin, so it will **consume the rest of a
piped script** (`ssh host 'bash -s' < script.sh`). Always redirect: `... </dev/null`.

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
