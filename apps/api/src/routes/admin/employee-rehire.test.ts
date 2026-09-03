import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  as, assertTestDatabase, makeUser, migrate, positionId, prisma, syncPermissions, syncPositions,
  truncateAll,
} from '../../test/harness'

/**
 * Leaving, and coming back.
 *
 * Staff who leave are kept on the books, and a rehire STARTS FRESH: probation,
 * holiday-pay eligibility and length of service all run from the new hire date,
 * and nothing from the earlier spell counts toward them. The earlier spell is
 * filed rather than overwritten — "have they worked here before, and why did
 * they leave" is a question that gets asked, and a rewritten hire date answers
 * it wrongly and silently.
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

async function seed() {
  const employee = await prisma.employee.create({
    data: {
      firstName: 'Maria', lastName: 'Cruz', positionId: await positionId('Cashier'),
      dateHired: new Date('2023-04-10T00:00:00.000Z'),
      employmentType: 'REGULAR',
      regularizedAt: new Date('2023-10-07T00:00:00.000Z'),
      sssNumber: '34-1234567-8',
      address: '12 Rizal St, Davao City',
      contacts: { create: [{ number: '0917 555 1234', label: 'Globe', sortOrder: 0 }] },
    },
  })
  const { token } = await makeUser({
    email: `hr${Math.random()}@t.local`,
    permissions: ['employees:read', 'employees:write', 'hr:read', 'hr:write'],
  })
  return { employee, token }
}

describe('separating an employee', () => {
  it('records the date and reason and takes them off the roster in one step', async () => {
    const { employee, token } = await seed()
    const res = await as(token)
      .post(`/api/admin/employees/${employee.id}/separate`, {
        separatedOn: '2025-06-30',
        separationReason: 'Resigned — moved to Manila.',
      })
      .expect(200)

    expect(res.body.data.hr.separatedAt).toBe('2025-06-30')
    expect(res.body.data.hr.separationReason).toBe('Resigned — moved to Manila.')
    // Both, or they stay on next week's schedule.
    expect(res.body.data.isActive).toBe(false)
  })

  it('refuses a leaving date before they were hired', async () => {
    const { employee, token } = await seed()
    await as(token)
      .post(`/api/admin/employees/${employee.id}/separate`, { separatedOn: '2020-01-01' })
      .expect(400)
  })

  it('keeps the whole record — a leaver is not deleted', async () => {
    const { employee, token } = await seed()
    await as(token).post(`/api/admin/employees/${employee.id}/separate`, { separatedOn: '2025-06-30' }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.sssNumber).toBe('34-1234567-8')
    expect(res.body.data.hr.address).toBe('12 Rizal St, Davao City')
    expect(res.body.data.hr.contacts).toHaveLength(1)
  })
})

describe('rehiring', () => {
  async function separated() {
    const { employee, token } = await seed()
    await as(token)
      .post(`/api/admin/employees/${employee.id}/separate`, {
        separatedOn: '2025-06-30',
        separationReason: 'Resigned — moved to Manila.',
      })
      .expect(200)
    return { employee, token }
  }

  /** The whole rule in one test: the clock restarts. */
  it('starts them fresh from the new hire date', async () => {
    const { employee, token } = await separated()
    const res = await as(token)
      .post(`/api/admin/employees/${employee.id}/rehire`, {
        dateHired: '2026-09-01',
        employmentType: 'PROBATIONARY',
        probationEndDate: '2027-03-01',
      })
      .expect(200)

    const hr = res.body.data.hr
    expect(hr.dateHired).toBe('2026-09-01')
    expect(hr.employmentType).toBe('PROBATIONARY')
    expect(hr.probationEndDate).toBe('2027-03-01')
    // Nothing from the old spell carries over — that is what "fresh" means.
    expect(hr.regularizedAt).toBeNull()
    expect(hr.separatedAt).toBeNull()
    expect(hr.separationReason).toBeNull()
    expect(res.body.data.isActive).toBe(true)
  })

  it('files the old spell instead of overwriting it', async () => {
    const { employee, token } = await separated()
    const res = await as(token)
      .post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-09-01' })
      .expect(200)

    expect(res.body.data.hr.pastEmployment).toHaveLength(1)
    const [old] = res.body.data.hr.pastEmployment
    expect(old.hiredOn).toBe('2023-04-10')
    expect(old.separatedOn).toBe('2025-06-30')
    expect(old.separationReason).toBe('Resigned — moved to Manila.')
    expect(old.employmentType).toBe('REGULAR')
    expect(old.regularizedAt).toBe('2023-10-07')
  })

  it('keeps everything that belongs to the person rather than the spell', async () => {
    const { employee, token } = await separated()
    const res = await as(token)
      .post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-09-01' })
      .expect(200)

    expect(res.body.data.hr.sssNumber).toBe('34-1234567-8')
    expect(res.body.data.hr.address).toBe('12 Rizal St, Davao City')
    expect(res.body.data.hr.contacts).toHaveLength(1)
  })

  it('stacks spells for somebody taken back more than once', async () => {
    const { employee, token } = await separated()
    await as(token).post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-01-05' }).expect(200)
    await as(token).post(`/api/admin/employees/${employee.id}/separate`, {
      separatedOn: '2026-05-30', separationReason: 'Left again.',
    }).expect(200)
    const res = await as(token)
      .post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-09-01' })
      .expect(200)

    const spells = res.body.data.hr.pastEmployment
    expect(spells).toHaveLength(2)
    // Newest first: the most recent spell answers "have they been back before".
    expect(spells[0].hiredOn).toBe('2026-01-05')
    expect(spells[1].hiredOn).toBe('2023-04-10')
  })

  it('refuses to rehire somebody who never left', async () => {
    const { employee, token } = await seed()
    const res = await as(token)
      .post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-09-01' })
      .expect(409)
    expect(res.body.error.code).toBe('NOT_SEPARATED')
  })

  it('refuses a start date before the day they left', async () => {
    const { employee, token } = await separated()
    await as(token)
      .post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2025-01-01' })
      .expect(400)
  })

  it('needs hr:write — this is not an everyday staff edit', async () => {
    const { employee } = await separated()
    const { token } = await makeUser({
      email: 'plain@t.local',
      permissions: ['employees:read', 'employees:write'],
    })
    await as(token).post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-09-01' }).expect(403)
    await as(token).post(`/api/admin/employees/${employee.id}/separate`, { separatedOn: '2026-09-01' }).expect(403)
  })

  it('hides past spells from a caller without hr:read, like the rest of the 201 file', async () => {
    const { employee, token } = await separated()
    await as(token).post(`/api/admin/employees/${employee.id}/rehire`, { dateHired: '2026-09-01' }).expect(200)

    const { token: plain } = await makeUser({ email: 'nohr@t.local', permissions: ['employees:read'] })
    const res = await as(plain).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data).not.toHaveProperty('hr')
    expect(JSON.stringify(res.body)).not.toContain('moved to Manila')
  })
})
