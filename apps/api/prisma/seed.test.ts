import { execSync } from 'node:child_process'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@otomate/shared'
import { assertTestDatabase, migrate, prisma, truncateAll } from '../src/test/harness'

/**
 * The seed runs on EVERY deploy, to mirror the permission catalog into the
 * database. That makes it a program which repeatedly asserts its will over live
 * data, so what it will and will not overwrite is a behaviour worth pinning.
 *
 * These tests exist because it silently undid a deliberate change once:
 * admin@otomate.local was set to human_resource through the admin UI and was
 * back to super_admin after the next deploy, with nothing to explain why.
 */

const seed = () =>
  execSync('npx prisma db seed', {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, SEED_ADMIN_PASSWORD: 'SeedPassw0rd!' },
  }).toString()

const roleOf = async (email: string) => {
  const u = await prisma.user.findUnique({ where: { email }, include: { role: true } })
  return u?.role.name ?? null
}

beforeAll(() => {
  assertTestDatabase()
  migrate()
})
afterAll(async () => { await prisma.$disconnect() })
beforeEach(async () => { await truncateAll() })

describe('permission catalog', () => {
  it('mirrors every permission from packages/shared', async () => {
    seed()
    const count = await prisma.permission.count()
    expect(count).toBe(PERMISSIONS.length)
  })

  it('removes a permission that no longer exists in shared', async () => {
    seed()
    await prisma.permission.create({ data: { name: 'ghost:read', category: 'Gone' } })

    const out = seed()
    expect(out).toContain('ghost:read')
    expect(await prisma.permission.findUnique({ where: { name: 'ghost:read' } })).toBeNull()
  })

  it('is idempotent — running it twice changes nothing', async () => {
    seed()
    const before = await prisma.permission.count()
    seed()
    expect(await prisma.permission.count()).toBe(before)
  })
})

describe('the owner account', () => {
  it('creates it as super_admin on an empty database', async () => {
    seed()
    expect(await roleOf('admin@otomate.local')).toBe('super_admin')
  })

  /**
   * REGRESSION. This is the bug: with the seed running on every deploy, an
   * unconditional promotion silently reverted a role set in the admin UI.
   */
  it('respects a demotion when another active super admin exists', async () => {
    seed()
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } })
    const hr = await prisma.role.create({ data: { name: 'human_resource' } })
    await prisma.user.create({
      data: {
        email: 'owner@otomate.uk', password: 'x', name: 'Owner',
        roleId: superAdmin.id, isActive: true,
      },
    })
    await prisma.user.update({
      where: { email: 'admin@otomate.local' },
      data: { roleId: hr.id },
    })

    const out = seed()
    expect(await roleOf('admin@otomate.local')).toBe('human_resource')
    expect(out).toContain('left alone')
  })

  it('promotes it when no super admin is left — the lock-out guard', async () => {
    seed()
    const hr = await prisma.role.create({ data: { name: 'human_resource' } })
    await prisma.user.update({ where: { email: 'admin@otomate.local' }, data: { roleId: hr.id } })

    seed()
    expect(await roleOf('admin@otomate.local')).toBe('super_admin')
  })

  it('promotes it when the only other super admin is deactivated', async () => {
    // A deactivated account cannot sign in, so it is not a way back in.
    seed()
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } })
    const hr = await prisma.role.create({ data: { name: 'human_resource' } })
    await prisma.user.create({
      data: {
        email: 'dormant@otomate.uk', password: 'x', name: 'Dormant',
        roleId: superAdmin.id, isActive: false,
      },
    })
    await prisma.user.update({ where: { email: 'admin@otomate.local' }, data: { roleId: hr.id } })

    seed()
    expect(await roleOf('admin@otomate.local')).toBe('super_admin')
  })

  it('never touches the password of an existing account', async () => {
    seed()
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@otomate.local' } })

    seed()
    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@otomate.local' } })
    expect(after.password).toBe(before.password)
  })

  it('does not resurrect a deactivated owner account', async () => {
    // Deactivating the seeded account is a legitimate thing to do once a real
    // owner login exists.
    seed()
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } })
    await prisma.user.create({
      data: {
        email: 'real-owner@otomate.uk', password: 'x', name: 'Owner',
        roleId: superAdmin.id, isActive: true,
      },
    })
    await prisma.user.update({ where: { email: 'admin@otomate.local' }, data: { isActive: false } })

    seed()
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@otomate.local' } })
    expect(admin.isActive).toBe(false)
  })
})
