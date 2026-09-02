import { execSync } from 'node:child_process'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { DEFAULT_EMPLOYEE_POSITIONS, PERMISSIONS, type PermissionName } from '@otomate/shared'
import app from '../app'
import { prisma } from '../prisma/client'
import { resetRateLimitsForTests } from '../middleware/rate-limit'

/**
 * Integration tests run against a REAL Postgres.
 *
 * The things these cover — which fields a permission does and does not return,
 * whether a guard refuses a delete, whether a DATE survives a round trip — are
 * exactly the things a mocked database would answer wrongly, because they are
 * properties of the database and the query, not of the code shape.
 *
 * Requires DATABASE_URL to point at a THROWAWAY database. Every test truncates.
 */

const REQUIRED = 'postgresql://'

export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL
  if (!url?.startsWith(REQUIRED)) {
    throw new Error('DATABASE_URL must be set to a throwaway Postgres for tests')
  }
  // Refuse to run against anything that is not obviously disposable. These
  // tests TRUNCATE every table.
  if (!/otomate_test|localhost|127\.0\.0\.1|@postgres[:/]/.test(url)) {
    throw new Error(
      `Refusing to run destructive tests against ${url.replace(/:[^:@]*@/, ':***@')} — ` +
        'it does not look like a local or throwaway database'
    )
  }
}

export function migrate(): void {
  execSync('npx prisma migrate deploy', { cwd: process.cwd(), stdio: 'pipe' })
}

/**
 * Empties every table between tests.
 *
 * Generated from the catalog rather than hand-listed, so a table added later is
 * cleaned automatically instead of leaking rows into the next test — a listed
 * set silently rots the moment someone adds a model.
 */
export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `
  if (rows.length === 0) return
  const list = rows.map(r => `"public"."${r.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  resetRateLimitsForTests()
}

/** Every permission in the catalog, for building a super-user-equivalent role. */
export const ALL_PERMISSIONS = PERMISSIONS.map(p => p.name)

/**
 * Creates a user holding exactly the permissions given, and returns a bearer
 * token for it.
 *
 * `isSuperAdmin: false` on the role deliberately — a super admin bypasses every
 * permission check, so testing gating with one would prove nothing.
 */
export async function makeUser(opts: {
  email: string
  permissions: readonly PermissionName[]
  roleName?: string
  branchId?: string | null
}): Promise<{ token: string; userId: string }> {
  const permissionRows = await prisma.permission.findMany({
    where: { name: { in: [...opts.permissions] } },
  })
  if (permissionRows.length !== opts.permissions.length) {
    const found = new Set(permissionRows.map(p => p.name))
    const missing = opts.permissions.filter(p => !found.has(p))
    throw new Error(`Permissions missing from the catalog: ${missing.join(', ')}`)
  }

  const role = await prisma.role.create({
    data: {
      name: opts.roleName ?? `role_${opts.email.replace(/\W/g, '_')}`,
      permissions: { connect: permissionRows.map(p => ({ id: p.id })) },
    },
  })
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      password: await bcrypt.hash('TestPassw0rd!', 4), // low cost: speed, not security
      name: opts.email,
      roleId: role.id,
      branchId: opts.branchId ?? null,
      mustChangePassword: false,
    },
  })

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: opts.email, password: 'TestPassw0rd!' })
  if (res.status !== 200) {
    throw new Error(`Could not sign in the test user: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return { token: res.body.data.token as string, userId: user.id }
}

/** Mirrors the permission catalog into the database, as the seed does. */
export async function syncPermissions(): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: p.name },
      update: { category: p.category, description: p.description },
      create: { name: p.name, category: p.category, description: p.description },
    })
  }
}

/**
 * The default job positions.
 *
 * truncateAll() empties every table, including the positions the migration
 * seeded — and an employee cannot be created without one. Tests that make staff
 * call this the way they call syncPermissions().
 */
export async function syncPositions(): Promise<void> {
  for (const [i, name] of DEFAULT_EMPLOYEE_POSITIONS.entries()) {
    await prisma.employeePosition.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i },
    })
  }
}

/** The id of a position by name, for building employees in tests. */
export async function positionId(name = 'Other'): Promise<string> {
  const position = await prisma.employeePosition.findUnique({ where: { name } })
  if (!position) throw new Error(`No position named ${name} — call syncPositions() first`)
  return position.id
}

/** `request(app)` with the Authorization header already attached. */
export function as(token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`)
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: unknown) => auth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body?: unknown) => auth(request(app).put(url)).send(body ?? {}),
    patch: (url: string, body?: unknown) => auth(request(app).patch(url)).send(body ?? {}),
    delete: (url: string) => auth(request(app).delete(url)),
  }
}

export { app, prisma, request }
