import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { as, assertTestDatabase, makeUser, migrate, prisma, syncPermissions, truncateAll } from '../../test/harness'

/**
 * The short form a branch shows in a work-schedule cell.
 *
 * It exists because the cell is under a hundred pixels wide: someone rostered
 * at another branch has to read as "TRD", not "TRD Puan Branch". Unique, so one
 * short form cannot stand for two branches — that would make the grid say the
 * wrong thing rather than an ambiguous one.
 */

beforeAll(() => {
  assertTestDatabase()
  migrate()
})
afterAll(async () => { await prisma.$disconnect() })
beforeEach(async () => {
  await truncateAll()
  await syncPermissions()
})

const writer = () => makeUser({
  email: `br${Math.random()}@t.local`,
  permissions: ['branches:read', 'branches:write'],
})

describe('branch short name', () => {
  it('is optional — a branch without one is fine', async () => {
    const { token } = await writer()
    const res = await as(token).post('/api/admin/branches', { name: 'Matina' }).expect(201)
    expect(res.body.data.abbreviation).toBeNull()
  })

  it('is stored and returned', async () => {
    const { token } = await writer()
    const res = await as(token)
      .post('/api/admin/branches', { name: 'TRD Puan', abbreviation: 'TRD' })
      .expect(201)
    expect(res.body.data.abbreviation).toBe('TRD')
  })

  it('can be set on a branch that had none, and cleared again', async () => {
    const { token } = await writer()
    const made = await as(token).post('/api/admin/branches', { name: 'KM 11' }).expect(201)

    const set = await as(token)
      .patch(`/api/admin/branches/${made.body.data.id}`, { abbreviation: 'KM11' })
      .expect(200)
    expect(set.body.data.abbreviation).toBe('KM11')

    const cleared = await as(token)
      .patch(`/api/admin/branches/${made.body.data.id}`, { abbreviation: null })
      .expect(200)
    expect(cleared.body.data.abbreviation).toBeNull()
  })

  /**
   * Blank has to become NULL, not an empty string — the second branch left
   * blank would otherwise collide on the unique index.
   */
  it('treats an empty short name as none', async () => {
    const { token } = await writer()
    await as(token).post('/api/admin/branches', { name: 'One', abbreviation: '' }).expect(400)

    const a = await as(token).post('/api/admin/branches', { name: 'Two' }).expect(201)
    const b = await as(token).post('/api/admin/branches', { name: 'Three' }).expect(201)
    expect(a.body.data.abbreviation).toBeNull()
    expect(b.body.data.abbreviation).toBeNull()
  })

  it('refuses one too long to fit a cell', async () => {
    const { token } = await writer()
    await as(token)
      .post('/api/admin/branches', { name: 'Bangkerohan', abbreviation: 'BANGKER' })
      .expect(400)
  })

  it('refuses punctuation and spaces', async () => {
    const { token } = await writer()
    await as(token).post('/api/admin/branches', { name: 'A', abbreviation: 'KM 11' }).expect(400)
    await as(token).post('/api/admin/branches', { name: 'B', abbreviation: 'K-11' }).expect(400)
  })

  it('refuses a short name another branch already uses', async () => {
    const { token } = await writer()
    await as(token).post('/api/admin/branches', { name: 'TRD Puan', abbreviation: 'TRD' }).expect(201)
    const res = await as(token)
      .post('/api/admin/branches', { name: 'Toril', abbreviation: 'TRD' })
      .expect(409)
    expect(res.body.error.message).toContain('short name')
  })
})
