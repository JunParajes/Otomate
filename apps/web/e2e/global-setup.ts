import { execSync } from 'node:child_process'
import { DEFAULT_EMPLOYEE_POSITIONS } from '@otomate/shared'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Migrates the test database and seeds a fixed world for the browser tests.
 *
 * Runs before the web servers start, so the API has a schema to talk to. The
 * data is created through the API rather than by writing rows directly, so the
 * fixtures exercise the same validation the app does — a fixture the API would
 * reject is a fixture that proves nothing.
 */
const API = `http://localhost:${process.env.E2E_API_PORT ?? '3994'}`

/** Where globalSetup leaves the ids it created, for the specs to read. */
export const FIXTURE_FILE = new URL('./.fixtures.json', import.meta.url).pathname

export const FIXTURES = {
  owner: { email: 'owner@e2e.local', password: 'E2ePassw0rd!' },
  /** Holds employees:* but NOT hr:* — for testing what the UI hides. */
  plain: { email: 'plain@e2e.local', password: 'E2ePassw0rd!' },
  branch: 'Matina',
  otherBranch: 'Toril',
  product: 'Pandesal',
}

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`)
  }
  return json.data
}

async function waitForApi(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`API never became ready at ${API}`)
}

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  // This DROPS the schema. Refuse anything that is not obviously disposable.
  if (!/otomate_e2e|otomate_test/.test(url) || !/localhost|127\.0\.0\.1|@postgres[:/]/.test(url)) {
    throw new Error(
      `Refusing to reset ${url.replace(/:[^:@]*@/, ':***@')} — ` +
        'browser tests need a throwaway database named otomate_e2e'
    )
  }

  const cwd = new URL('../../api', import.meta.url).pathname
  execSync('npx prisma migrate deploy', { cwd, stdio: 'pipe' })

  // Empty every table before seeding. The fixtures below create named roles and
  // users, so a second run against leftover data fails on a duplicate name — and
  // a suite that only passes on a fresh database is a suite nobody re-runs.
  //
  // Truncation rather than `migrate reset`: this clears data without dropping
  // the schema, and the table list comes from the catalog so a model added later
  // is cleaned automatically instead of leaking rows into the next run.
  execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    input: `
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables
                 WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
        LOOP
          EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
        END LOOP;
      END $$;
    `,
  })
  execSync('npx prisma db seed', {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, SEED_ADMIN_PASSWORD: 'E2ePassw0rd!' },
  })

  // The API is started by playwright's webServer, but globalSetup runs first —
  // start a throwaway request loop until it answers.
  await waitForApi()

  const admin = (await api(null, 'POST', '/api/auth/login', {
    email: 'admin@otomate.local',
    password: 'E2ePassw0rd!',
  })).token

  const permissions = await api(admin, 'GET', '/api/admin/permissions')
  const names = (permissions as { name: string }[]).map(p => p.name)

  const ownerRole = await api(admin, 'POST', '/api/admin/roles', {
    name: 'e2e_owner', description: 'everything', permissions: names,
  })
  const plainRole = await api(admin, 'POST', '/api/admin/roles', {
    name: 'e2e_plain',
    description: 'staff without HR',
    permissions: names.filter(n => !n.startsWith('hr:') && !n.startsWith('branches:')),
  })

  for (const [user, role] of [[FIXTURES.owner, ownerRole], [FIXTURES.plain, plainRole]] as const) {
    await api(admin, 'POST', '/api/admin/users', {
      email: user.email, name: user.email, password: user.password,
      roleId: (role as { id: string }).id, mustChangePassword: false,
    })
  }

  const branch = await api(admin, 'POST', '/api/admin/branches', { name: FIXTURES.branch, isActive: true })
  const category = await api(admin, 'POST', '/api/admin/categories', { name: 'Breads', isActive: true, sortOrder: 1 })
  const product = await api(admin, 'POST', '/api/admin/products', {
    name: FIXTURES.product, categoryId: (category as { id: string }).id,
    priceCents: 300, unit: 'PIECE', isActive: true,
  })
  /*
   * Positions are rows now, not an enum value that can be named inline.
   *
   * The migration seeds them, but the truncation above empties every table, so
   * they have to be put back — the same reason the roles and users below are
   * created here rather than assumed.
   */
  for (const [i, name] of DEFAULT_EMPLOYEE_POSITIONS.entries()) {
    await api(admin, 'POST', '/api/admin/positions', { name, sortOrder: i, isActive: true })
  }
  const positions = (await api(admin, 'GET', '/api/admin/positions')) as { id: string; name: string }[]
  const cashier = positions.find(p => p.name === 'Cashier')
  if (!cashier) throw new Error('No Cashier position — did the position seeding above fail?')
  const employee = await api(admin, 'POST', '/api/admin/employees', {
    firstName: 'Maria', middleName: 'Santos', lastName: 'Cruz',
    positionId: cashier.id, branchId: (branch as { id: string }).id,
  })

  /*
   * A few colleagues, across two branches.
   *
   * One employee was enough while the schedule was a single table, and it is
   * not any more: the "covered by" picker groups colleagues by branch and puts
   * the person's own branch first, which a one-person fixture cannot show at
   * all. Seeding realistic volume locally is what surfaced the grid problems a
   * three-row fixture had hidden, and the same applies here in miniature.
   */
  const second = await api(admin, 'POST', '/api/admin/branches', {
    name: FIXTURES.otherBranch, isActive: true,
  })
  const baker = positions.find(p => p.name === 'Baker')!
  for (const [first, last, at] of [
    ['Ana', 'Reyes', branch],
    ['Ben', 'Dorilag', second],
    ['Cora', 'Ecling', second],
  ] as const) {
    await api(admin, 'POST', '/api/admin/employees', {
      firstName: first, lastName: last,
      positionId: baker.id, branchId: (at as { id: string }).id,
    })
  }

  // The draft the entry tests use, built through the API rather than by driving
  // the create-report and add-product dialogs. Those flows are covered by the
  // API tests; what a browser is needed for is the input behaviour inside the
  // report, and getting there through four dialogs makes the test fail for
  // reasons that have nothing to do with what it is checking.
  const report = await api(admin, 'POST', '/api/admin/dsir', {
    branchId: (branch as { id: string }).id,
    reportDate: '2026-07-02',
  })
  const reportId = (report as { id: string }).id
  await api(admin, 'PUT', `/api/admin/dsir/${reportId}`, {
    usesCharges: false, usesPullOuts: false, usesTransfers: false, usesOverEnd: false,
    lines: [{
      productId: (product as { id: string }).id,
      begBal: 0, produced: 0, overEnd: 0, pulledOut: 0, endBal: 0,
    }],
    charges: [], transfers: [], collections: [],
  })

  mkdirSync(dirname(FIXTURE_FILE), { recursive: true })
  writeFileSync(FIXTURE_FILE, JSON.stringify({
    reportId,
    branchId: (branch as { id: string }).id,
    employeeId: (employee as { id: string }).id,
  }, null, 2))
}
