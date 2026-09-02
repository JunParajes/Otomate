import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  as, assertTestDatabase, makeUser, migrate, positionId, prisma, syncPermissions, syncPositions,
  truncateAll,
} from '../../test/harness'

/**
 * Employee positions as data.
 *
 * These were a Prisma enum until 2026-09-02, so the interesting cases are the
 * ones an enum could not get wrong: deleting a position somebody holds, renaming
 * one without orphaning the staff on it, and keeping the list behind a
 * permission that is not simply "can edit employees".
 */

beforeAll(() => {
  assertTestDatabase()
  migrate()
})
afterAll(async () => { await prisma.$disconnect() })
beforeEach(async () => {
  await truncateAll()
  await syncPermissions()
  await syncPositions()
})

describe('employee positions', () => {
  it('lists the defaults with a count of who holds each', async () => {
    const { token } = await makeUser({ email: 'r@t.local', permissions: ['employees:read'] })
    await prisma.employee.create({
      data: { firstName: 'Maria', lastName: 'Cruz', positionId: await positionId('Cashier') },
    })

    const res = await as(token).get('/api/admin/positions').expect(200)
    const names = res.body.data.map((p: { name: string }) => p.name)
    expect(names).toContain('Baker')
    expect(res.body.data.find((p: { name: string }) => p.name === 'Cashier').employeeCount).toBe(1)
    expect(res.body.data.find((p: { name: string }) => p.name === 'Baker').employeeCount).toBe(0)
  })

  it('adds a position that did not exist before', async () => {
    const { token } = await makeUser({ email: 'w@t.local', permissions: ['positions:write'] })
    const res = await as(token).post('/api/admin/positions', { name: 'Pastry Chef' }).expect(201)
    expect(res.body.data.name).toBe('Pastry Chef')
    expect(res.body.data.employeeCount).toBe(0)
  })

  it('refuses a duplicate name with a readable message', async () => {
    const { token } = await makeUser({ email: 'w2@t.local', permissions: ['positions:write'] })
    await as(token).post('/api/admin/positions', { name: 'Baker' }).expect(409)
  })

  /**
   * The reason employees store a position ID rather than its name: renaming
   * "Frontliner" to "Front of House" must not orphan a single person.
   */
  it('renames without disturbing the staff who hold it', async () => {
    const { token } = await makeUser({
      email: 'w3@t.local',
      permissions: ['positions:write', 'employees:read'],
    })
    const id = await positionId('Frontliner')
    const employee = await prisma.employee.create({
      data: { firstName: 'Ana', lastName: 'Reyes', positionId: id },
    })

    await as(token).patch(`/api/admin/positions/${id}`, { name: 'Front of House' }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.position.name).toBe('Front of House')
    expect(res.body.data.position.id).toBe(id)
  })

  /**
   * The foreign key is ON DELETE RESTRICT, so without this guard the caller gets
   * a raw Postgres error instead of an explanation.
   */
  it('refuses to delete a position somebody still holds, and says how many', async () => {
    const { token } = await makeUser({ email: 'w4@t.local', permissions: ['positions:write'] })
    const id = await positionId('Driver')
    await prisma.employee.create({ data: { firstName: 'Jun', lastName: 'Cruz', positionId: id } })

    const res = await as(token).delete(`/api/admin/positions/${id}`).expect(409)
    expect(res.body.error.code).toBe('POSITION_IN_USE')
    expect(res.body.error.message).toContain('1 employee')

    // Still there — a refused delete must not have half-happened.
    expect(await prisma.employeePosition.findUnique({ where: { id } })).not.toBeNull()
  })

  it('deletes one nobody holds', async () => {
    const { token } = await makeUser({ email: 'w5@t.local', permissions: ['positions:write'] })
    const id = await positionId('Helper')
    await as(token).delete(`/api/admin/positions/${id}`).expect(200)
    expect(await prisma.employeePosition.findUnique({ where: { id } })).toBeNull()
  })

  it('lets a retired position be deactivated while its staff keep it', async () => {
    const { token } = await makeUser({
      email: 'w6@t.local',
      permissions: ['positions:write', 'employees:read'],
    })
    const id = await positionId('Driver')
    const employee = await prisma.employee.create({
      data: { firstName: 'Jun', lastName: 'Cruz', positionId: id },
    })

    await as(token).patch(`/api/admin/positions/${id}`, { isActive: false }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.position.name).toBe('Driver')
  })

  describe('permissions', () => {
    it('lets anyone with employees:read see the list — the picker needs it', async () => {
      const { token } = await makeUser({ email: 'p1@t.local', permissions: ['employees:read'] })
      await as(token).get('/api/admin/positions').expect(200)
    })

    it('refuses the list without employees:read', async () => {
      const { token } = await makeUser({ email: 'p2@t.local', permissions: ['products:read'] })
      await as(token).get('/api/admin/positions').expect(403)
    })

    /**
     * employees:write is an everyday branch task. Changing the list of job roles
     * changes what every branch can pick from, so it is deliberately separate.
     */
    it('refuses to add a position with only employees:write', async () => {
      const { token } = await makeUser({
        email: 'p3@t.local',
        permissions: ['employees:read', 'employees:write'],
      })
      await as(token).post('/api/admin/positions', { name: 'Nope' }).expect(403)
      await as(token).delete(`/api/admin/positions/${await positionId('Baker')}`).expect(403)
    })
  })
})
