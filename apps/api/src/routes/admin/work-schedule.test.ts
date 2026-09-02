import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  as, assertTestDatabase, makeUser, migrate, positionId, prisma, syncPermissions, syncPositions,
  truncateAll,
} from '../../test/harness'

/**
 * The work schedule — the plan for one Thursday-to-Wednesday cutoff.
 *
 * The sample week throughout is the one from the spreadsheet this replaces:
 * Thursday 27 August to Wednesday 2 September 2026.
 */

const THU = '2026-08-27'
const WED = '2026-09-02'

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

async function seedStaff(count = 3) {
  const branch = await prisma.branch.create({ data: { name: 'Bankerohan' } })
  const pos = await positionId('Baker')
  const employees = []
  for (let i = 0; i < count; i++) {
    employees.push(await prisma.employee.create({
      data: { firstName: `Staff${i}`, lastName: 'Cruz', positionId: pos, branchId: branch.id },
    }))
  }
  return { branch, employees }
}

const hr = () => makeUser({
  email: `hr${Math.random()}@t.local`,
  permissions: ['employees:read', 'schedule:read', 'schedule:write'],
})
const gm = () => makeUser({
  email: `gm${Math.random()}@t.local`,
  permissions: ['employees:read', 'schedule:read', 'schedule:write', 'schedule:approve'],
})

describe('creating a cutoff', () => {
  it('refuses a start date that is not a Thursday', async () => {
    const { token } = await hr()
    await as(token).post('/api/admin/work-schedule', { weekStart: '2026-08-31' }).expect(400)
  })

  /**
   * Most cells in the spreadsheet are a tick, so a blank grid would mean typing
   * "as usual" five hundred times. HR should be marking exceptions only.
   */
  it('pre-fills every active employee as scheduled on all seven days', async () => {
    const { employees } = await seedStaff(3)
    const { token } = await hr()

    const res = await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    expect(res.body.data.days).toHaveLength(7)
    expect(res.body.data.weekEnd).toBe(WED)
    expect(res.body.data.rows).toHaveLength(3)

    const counted = await prisma.workScheduleEntry.count()
    expect(counted).toBe(employees.length * 7)
    for (const row of res.body.data.rows) {
      expect(Object.keys(row.days)).toHaveLength(7)
      expect(row.days[THU].status).toBe('SCHEDULED')
    }
  })

  it('leaves inactive staff out of the plan', async () => {
    const { employees } = await seedStaff(2)
    await prisma.employee.update({ where: { id: employees[0]!.id }, data: { isActive: false } })
    const { token } = await hr()

    const res = await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    expect(res.body.data.rows).toHaveLength(1)
  })

  it('refuses a second schedule for the same cutoff', async () => {
    await seedStaff(1)
    const { token } = await hr()
    await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(409)
  })

  /**
   * The days are stored as dates and read back as strings. Davao is UTC+8, so a
   * day handled in local time reads back as the previous one — a schedule off by
   * a day is worse than no schedule.
   */
  it('returns the same seven days it was given', async () => {
    await seedStaff(1)
    const { token } = await hr()
    const res = await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    expect(res.body.data.days).toEqual([
      '2026-08-27', '2026-08-28', '2026-08-29',
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ])
    expect(Object.keys(res.body.data.rows[0].days).sort()).toEqual(res.body.data.days)
  })
})

describe('editing the plan', () => {
  async function draft() {
    const { employees, branch } = await seedStaff(2)
    const { token } = await hr()
    const res = await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    return { id: res.body.data.id as string, employees, branch, token }
  }

  it('saves the five statuses', async () => {
    const { id, employees, token } = await draft()
    const me = employees[0]!.id
    const days = ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31']
    const statuses = ['SCHEDULED', 'NOT_SCHEDULED', 'OFF', 'FRONTLINE', 'OPENER'] as const

    const res = await as(token)
      .patch(`/api/admin/work-schedule/${id}/entries`, {
        entries: days.map((day, i) => ({ employeeId: me, day, status: statuses[i] })),
      })
      .expect(200)

    const row = res.body.data.rows.find((r: { employeeId: string }) => r.employeeId === me)
    days.forEach((day, i) => expect(row.days[day].status).toBe(statuses[i]))
  })

  it('records the branch someone is sent to', async () => {
    const { id, employees, token } = await draft()
    const other = await prisma.branch.create({ data: { name: 'TRD' } })

    const res = await as(token)
      .patch(`/api/admin/work-schedule/${id}/entries`, {
        entries: [{ employeeId: employees[0]!.id, day: THU, status: 'SCHEDULED', assignedBranchId: other.id }],
      })
      .expect(200)

    const row = res.body.data.rows.find((r: { employeeId: string }) => r.employeeId === employees[0]!.id)
    expect(row.days[THU].assignedBranch.name).toBe('TRD')
  })

  it('records who covers a day off, and who someone is paired with', async () => {
    const { id, employees, token } = await draft()
    const [a, b] = employees

    const res = await as(token)
      .patch(`/api/admin/work-schedule/${id}/entries`, {
        entries: [
          { employeeId: a!.id, day: THU, status: 'OFF', coveredById: b!.id },
          { employeeId: b!.id, day: THU, status: 'SCHEDULED', pairedWithId: a!.id },
        ],
      })
      .expect(200)

    const rowA = res.body.data.rows.find((r: { employeeId: string }) => r.employeeId === a!.id)
    const rowB = res.body.data.rows.find((r: { employeeId: string }) => r.employeeId === b!.id)
    expect(rowA.days[THU].coveredBy.name).toContain('Staff1')
    expect(rowB.days[THU].pairedWith.name).toContain('Staff0')
  })

  /**
   * "Covered by" only means something on a day off. Leaving it attached after a
   * status change would show a reliever for a day the person is working.
   */
  it('clears the reliever when a day stops being an off day', async () => {
    const { id, employees, token } = await draft()
    const [a, b] = employees
    await as(token).patch(`/api/admin/work-schedule/${id}/entries`, {
      entries: [{ employeeId: a!.id, day: THU, status: 'OFF', coveredById: b!.id }],
    }).expect(200)

    const res = await as(token).patch(`/api/admin/work-schedule/${id}/entries`, {
      entries: [{ employeeId: a!.id, day: THU, status: 'SCHEDULED', coveredById: b!.id }],
    }).expect(200)

    const row = res.body.data.rows.find((r: { employeeId: string }) => r.employeeId === a!.id)
    expect(row.days[THU].coveredBy).toBeNull()
  })

  it('refuses a day outside the cutoff', async () => {
    const { id, employees, token } = await draft()
    const res = await as(token)
      .patch(`/api/admin/work-schedule/${id}/entries`, {
        entries: [{ employeeId: employees[0]!.id, day: '2026-09-03', status: 'OFF' }],
      })
      .expect(400)
    expect(res.body.error.code).toBe('DAY_OUT_OF_RANGE')
  })

  /**
   * Someone hired mid-cutoff has no pre-filled entries. Building the grid from
   * entries rather than from the staff list would leave them off it entirely —
   * exactly the person most likely to be forgotten.
   */
  it('shows a newly hired employee even though they have no entries', async () => {
    const { id, token } = await draft()
    await prisma.employee.create({
      data: { firstName: 'New', lastName: 'Hire', positionId: await positionId('Helper') },
    })

    const res = await as(token).get(`/api/admin/work-schedule/${id}`).expect(200)
    const row = res.body.data.rows.find((r: { name: string }) => r.name === 'New Hire')
    expect(row).toBeDefined()
    expect(Object.keys(row.days)).toHaveLength(0)
  })

  it('flags staff under one month, who get no holiday pay or offsetting', async () => {
    const { id, token } = await draft()
    await prisma.employee.create({
      data: {
        firstName: 'Just', lastName: 'Joined', positionId: await positionId('Helper'),
        dateHired: new Date('2026-08-26T00:00:00.000Z'),
      },
    })
    await prisma.employee.create({
      data: {
        firstName: 'Long', lastName: 'Serving', positionId: await positionId('Helper'),
        dateHired: new Date('2020-01-01T00:00:00.000Z'),
      },
    })

    const res = await as(token).get(`/api/admin/work-schedule/${id}`).expect(200)
    const rows = res.body.data.rows as { name: string; eligibility: string }[]
    expect(rows.find(r => r.name === 'Just Joined')!.eligibility).toBe('UNDER_ONE_MONTH')
    expect(rows.find(r => r.name === 'Long Serving')!.eligibility).toBe('ELIGIBLE')
    // Nobody recorded a start date for the staff seeded without one. "We do not
    // know" is the honest answer, not "eligible".
    expect(rows.find(r => r.name.startsWith('Staff'))!.eligibility).toBe('NO_HIRE_DATE')
  })
})

/**
 * The grid shows a person's address and numbers when their name is tapped, and
 * those come from the 201 file. `schedule:read` alone must not be a way around
 * `hr:read` — the section is omitted rather than nulled, so an unauthorised
 * response carries no trace of an address at all.
 */
describe('the details behind a name', () => {
  async function scheduleWithStaff() {
    const branch = await prisma.branch.create({ data: { name: 'Bankerohan' } })
    const employee = await prisma.employee.create({
      data: {
        firstName: 'Maria', lastName: 'Cruz', positionId: await positionId('Baker'), branchId: branch.id,
        dateHired: new Date('2020-01-01T00:00:00.000Z'),
        address: '12 Rizal St, Davao City',
        contacts: { create: [{ number: '0917 555 1234', label: 'Globe', sortOrder: 0 }] },
      },
    })
    const { token: hrToken } = await makeUser({
      email: 'withhr@t.local',
      permissions: ['schedule:read', 'schedule:write', 'hr:read'],
    })
    const res = await as(hrToken).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    return { id: res.body.data.id as string, employee, hrToken }
  }

  it('includes address, hire date and numbers for a caller with hr:read', async () => {
    const { id, hrToken } = await scheduleWithStaff()
    const res = await as(hrToken).get(`/api/admin/work-schedule/${id}`).expect(200)
    const row = res.body.data.rows[0]
    expect(row.details.address).toBe('12 Rizal St, Davao City')
    expect(row.details.dateHired).toBe('2020-01-01')
    expect(row.details.contacts[0].number).toBe('0917 555 1234')
    expect(row.details.contacts[0].label).toBe('Globe')
  })

  it('omits the section entirely without hr:read, leaving no trace', async () => {
    const { id } = await scheduleWithStaff()
    const { token } = await makeUser({ email: 'nohr@t.local', permissions: ['schedule:read'] })

    const res = await as(token).get(`/api/admin/work-schedule/${id}`).expect(200)
    expect(res.body.data.rows[0]).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('Rizal')
    expect(JSON.stringify(res.body)).not.toContain('0917')
  })

  /**
   * The eligibility flag stays visible without hr:read: it is what the week is
   * planned against, and a yes/no discloses far less than the hire date it is
   * derived from.
   */
  it('still tells a planner whether someone is under a month', async () => {
    const { id } = await scheduleWithStaff()
    const { token } = await makeUser({ email: 'nohr2@t.local', permissions: ['schedule:read'] })
    const res = await as(token).get(`/api/admin/work-schedule/${id}`).expect(200)
    expect(res.body.data.rows[0]).toHaveProperty('eligibility')
    expect(res.body.data.rows[0].eligibility).toBe('ELIGIBLE')
  })
})

describe('draft, submit, approve', () => {
  async function draft(token: string) {
    await seedStaff(1)
    const res = await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
    return res.body.data.id as string
  }

  it('starts as a draft', async () => {
    const { token } = await hr()
    const id = await draft(token)
    const res = await as(token).get(`/api/admin/work-schedule/${id}`).expect(200)
    expect(res.body.data.status).toBe('DRAFT')
  })

  it('lets HR submit but not approve', async () => {
    const { token } = await hr()
    const id = await draft(token)
    await as(token).patch(`/api/admin/work-schedule/${id}`, { status: 'SUBMITTED' }).expect(200)
    await as(token).patch(`/api/admin/work-schedule/${id}`, { status: 'APPROVED' }).expect(403)
  })

  it('lets the approver approve, and stamps who and when', async () => {
    const { token: hrToken } = await hr()
    const { token: gmToken } = await gm()
    const id = await draft(hrToken)

    await as(hrToken).patch(`/api/admin/work-schedule/${id}`, { status: 'SUBMITTED' }).expect(200)
    const res = await as(gmToken).patch(`/api/admin/work-schedule/${id}`, { status: 'APPROVED' }).expect(200)

    expect(res.body.data.status).toBe('APPROVED')
    expect(res.body.data.approvedBy).not.toBeNull()
    expect(res.body.data.approvedAt).not.toBeNull()
  })

  /**
   * The whole point of splitting plan from actual: once approved, the plan is a
   * record. Editing it takes the approver, not the drafter.
   */
  it('locks an approved plan against HR edits', async () => {
    const { token: hrToken } = await hr()
    const { token: gmToken } = await gm()
    const id = await draft(hrToken)
    const employee = await prisma.employee.findFirstOrThrow()

    await as(gmToken).patch(`/api/admin/work-schedule/${id}`, { status: 'APPROVED' }).expect(200)

    const res = await as(hrToken)
      .patch(`/api/admin/work-schedule/${id}/entries`, {
        entries: [{ employeeId: employee.id, day: THU, status: 'OFF' }],
      })
      .expect(409)
    expect(res.body.error.code).toBe('SCHEDULE_APPROVED')

    // The approver can still correct it.
    await as(gmToken)
      .patch(`/api/admin/work-schedule/${id}/entries`, {
        entries: [{ employeeId: employee.id, day: THU, status: 'OFF' }],
      })
      .expect(200)
  })

  it('clears the approval when the schedule is reopened', async () => {
    const { token: gmToken } = await gm()
    const id = await draft(gmToken)
    await as(gmToken).patch(`/api/admin/work-schedule/${id}`, { status: 'APPROVED' }).expect(200)

    const res = await as(gmToken).patch(`/api/admin/work-schedule/${id}`, { status: 'DRAFT' }).expect(200)
    expect(res.body.data.status).toBe('DRAFT')
    expect(res.body.data.approvedBy).toBeNull()
    expect(res.body.data.approvedAt).toBeNull()
  })

  it('refuses to reopen an approved schedule without the approver permission', async () => {
    const { token: hrToken } = await hr()
    const { token: gmToken } = await gm()
    const id = await draft(hrToken)
    await as(gmToken).patch(`/api/admin/work-schedule/${id}`, { status: 'APPROVED' }).expect(200)
    await as(hrToken).patch(`/api/admin/work-schedule/${id}`, { status: 'DRAFT' }).expect(403)
  })
})

describe('permissions', () => {
  it('hides schedules from a caller without schedule:read', async () => {
    const { token } = await makeUser({ email: 'none@t.local', permissions: ['employees:read'] })
    await as(token).get('/api/admin/work-schedule').expect(403)
  })

  it('refuses drafting with only schedule:read', async () => {
    const { token } = await makeUser({ email: 'ro@t.local', permissions: ['schedule:read'] })
    await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(403)
  })
})
