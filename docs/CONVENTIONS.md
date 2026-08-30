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

### Beating a Mantine reset from a CSS Module

A CSS Module class and a Mantine component class are both **one class**, so
specificity ties — and Mantine's stylesheet is injected *after* the module, so
Mantine wins. Styling `UnstyledButton` with a plain `.action { padding: … }`
silently does nothing.

Write the selector twice. It is still one class in the markup:

```css
/* .action alone loses to UnstyledButton's reset; .action.action outranks it */
.action.action { padding: 12px 14px; border: 1px solid …; }
```

Check the computed style in a browser rather than the file — this failure is
invisible in the diff, and it has bitten twice (here, and the keypad's
`--button-padding-x`, which Mantine sets *inline* and no class can outrank).

## List Row Actions

Admin lists do **not** carry a trailing column of action buttons. The row itself
opens `RowActionsSheet`, which names the record and lists what can be done to it.

```tsx
<Table.Tr {...rowActionProps(canWrite, () => setActing(item))}>
```

- Use `rowActionProps` rather than a hand-written `onClick` — it also makes the
  row focusable and Enter/Space-activatable, which a bare `onClick` on a `<tr>`
  is not.
- Pass `enabled: false` for rows with nothing to do (system roles), so they are
  neither focusable nor pointer-cursored.
- Mark destructive actions `destructive: true`; they render red, below a rule.
- Prefer `disabled` + `disabledReason` over hiding an action — a missing option
  reads as a bug, a greyed one with a reason reads as an answer.
- Don't put anything else clickable inside the row; the row owns the tap.

The reason is the tablet: the old target was a ~36px icon at the far edge of a
wide table, and the first thing to scroll out of reach. The row is 744×50px.

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

## Calling the API from the web app

**Always go through `unwrap()` in `apps/web/src/lib/unwrap.ts`.** Never `await`
an axios call and read `data.error` directly.

Axios **rejects** its promise on any 4xx or 5xx, so the success path never sees
the response body. Reading `data.error` only works for a 200 — which the API
never returns for an error. Without `unwrap`, every considered message the API
produces is replaced by axios's generic string:

```
"1 user(s) still have this role…"   becomes   "Request failed with status code 409"
"Cannot deactivate the last active Super Admin"      "Request failed with status code 400"
```

`unwrap` digs the real message out of `err.response.data.error.message`, and
falls back sensibly when there is no body at all (network failure, 413).

This bug shipped unnoticed through three features because API tests checked the
messages **server-side** and browser tests only checked **client-side** zod
validation. Nothing exercised the path in between. When testing error handling,
assert on what the user actually sees in the browser.

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

## .env — single-quote every value

An unquoted value gets interpreted, and by **two** different readers with two
different rules.

**A shell that sources the file** performs parameter expansion. Any `$` in a
password propagates into `DATABASE_URL` and gets expanded — `$@`, `$1`, `$USER`
and friends silently collapse to something else, producing an invalid URL. Prisma
then fails with `P1013: invalid port number`, which points nowhere near the real
cause. This has already bitten this project once in production.

**Docker Compose also interpolates**, which this file previously claimed it did
not. Measured on 2026-08-30 with `docker compose run`:

| `.env` line | what the container receives |
|---|---|
| `SECRET=pa$$w0rd$USER` | `pa$w0rdjun` — `$$`→`$`, `$USER` expanded |
| `SECRET="pa$$w0rd$USER"` | `pa$w0rdjun` — **double quotes do not protect** |
| `SECRET='pa$$w0rd$USER'` | `pa$$w0rd$USER` — literal |

So "the containers work because Compose does not expand" was wrong. The containers
work when the value happens to contain no expandable sequence; the same file with
a different password would break them too, silently.

**Single quotes fix both readers**, because they suppress interpolation rather
than merely delimiting. A value containing a single quote is written `'\''` —
close, escape, reopen.

```bash
# WRONG — corrupts DATABASE_URL
set -a; . ./.env; set +a

# RIGHT — pull out only the plain values you need, let Compose handle the rest.
# The sed strips either quote style, so it works before and after quoting.
env_value() { grep -E "^$1=" .env | head -1 | cut -d= -f2- \
  | sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"; }
POSTGRES_USER=$(env_value POSTGRES_USER)
```

Changing quoting on a live `.env` is not automatically safe: it changes what
Compose resolves. Diff the resolved values before and after —
`docker compose config --format json` — and only keep the change if every value
is byte-identical.

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
