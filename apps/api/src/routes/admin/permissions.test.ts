import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS, as, assertTestDatabase, makeUser, migrate, prisma, syncPermissions, truncateAll,
} from '../../test/harness'

/**
 * What each permission does and does not return.
 *
 * These were hand-run against a disposable stack every time a gated section was
 * added — employees, then branches, then utilities — which is exactly the sort
 * of check that stops being run once it gets boring. The rule under test is that
 * a section is OMITTED rather than nulled for a caller without the permission,
 * so an unauthorised response carries no trace of the values at all.
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

async function seedEmployee() {
  const branch = await prisma.branch.create({ data: { name: 'Matina' } })
  const employee = await prisma.employee.create({
    data: {
      firstName: 'Maria', middleName: 'Santos', lastName: 'Cruz',
      position: 'CASHIER', branchId: branch.id,
      sssNumber: '34-1234567-8', tin: '123-456-789-000',
      dateHired: new Date('2026-03-01T00:00:00Z'),
      address: '12 Rizal St, Davao City',
    },
  })
  await prisma.employeeSalary.create({
    data: { employeeId: employee.id, basicCents: 45000, allowanceCents: 5000, effectiveFrom: new Date('2026-06-01T00:00:00Z') },
  })
  return { branch, employee }
}

describe('employee records — what each permission reveals', () => {
  it('gives employees:read the person but not the 201 file or pay', async () => {
    await seedEmployee()
    const { token } = await makeUser({ email: 'plain@t.local', permissions: ['employees:read'] })

    const res = await as(token).get('/api/admin/employees').expect(200)
    const [row] = res.body.data
    expect(row.name).toBe('Maria Santos Cruz')
    expect(row).not.toHaveProperty('hr')
    expect(row).not.toHaveProperty('salaryHistory')
  })

  it('leaves no trace of a government ID, address or amount in the payload', async () => {
    // Not "the field is null" — the whole section is absent, so there is nothing
    // to find in a network tab.
    await seedEmployee()
    const { token } = await makeUser({ email: 'plain2@t.local', permissions: ['employees:read'] })
    const res = await as(token).get('/api/admin/employees').expect(200)

    const raw = JSON.stringify(res.body)
    for (const secret of ['34-1234567-8', '123-456-789-000', 'Rizal St', '45000']) {
      expect(raw).not.toContain(secret)
    }
  })

  it('gives hr:read the 201 file but still not pay', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({ email: 'hr@t.local', permissions: ['employees:read', 'hr:read'] })

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.sssNumber).toBe('34-1234567-8')
    expect(res.body.data).not.toHaveProperty('salaryHistory')
  })

  it('gives hr:salary:read the pay history', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({
      email: 'pay@t.local',
      permissions: ['employees:read', 'hr:read', 'hr:salary:read'],
    })

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.salaryHistory).toHaveLength(1)
    expect(res.body.data.salaryHistory[0].basicCents).toBe(45000)
  })

  it('never puts pay in the LIST, even for someone allowed to see it', async () => {
    // The list would otherwise ship every employee's salary history to render a
    // table of names.
    await seedEmployee()
    const { token } = await makeUser({
      email: 'pay2@t.local',
      permissions: ['employees:read', 'hr:read', 'hr:salary:read'],
    })

    const res = await as(token).get('/api/admin/employees').expect(200)
    expect(res.body.data[0]).toHaveProperty('hr')
    expect(res.body.data[0]).not.toHaveProperty('salaryHistory')
  })

  it('refuses writes to sections the caller cannot see', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({
      email: 'writer@t.local',
      permissions: ['employees:read', 'employees:write'],
    })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, { tin: '999' }).expect(403)
    await as(token)
      .post(`/api/admin/employees/${employee.id}/salary`, {
        basicCents: 99999, effectiveFrom: '2026-12-01', rateType: 'DAILY',
      })
      .expect(403)
  })

  it('lets hr:write edit the 201 file without granting pay', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({
      email: 'hrw@t.local',
      permissions: ['employees:read', 'hr:read', 'hr:write'],
    })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, { tin: '111-222-333-000' }).expect(200)
    await as(token)
      .post(`/api/admin/employees/${employee.id}/salary`, {
        basicCents: 50000, effectiveFrom: '2026-12-01', rateType: 'DAILY',
      })
      .expect(403)
  })
})

describe('contact numbers', () => {
  it('stores several, in the order given', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({ email: 'c1@t.local', permissions: ALL_PERMISSIONS })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, {
      contacts: [
        { number: '0917 555 1234', label: 'Globe' },
        { number: '0999 111 2222', label: 'Smart' },
      ],
    }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.contacts.map((c: { number: string }) => c.number)).toEqual([
      '0917 555 1234', '0999 111 2222',
    ])
    expect(res.body.data.hr.contacts[0].label).toBe('Globe')
  })

  it('replaces the whole set, so a removed number is really gone', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({ email: 'c2@t.local', permissions: ALL_PERMISSIONS })
    const patch = (contacts: unknown) =>
      as(token).patch(`/api/admin/employees/${employee.id}/hr`, { contacts })

    await patch([{ number: 'A' }, { number: 'B' }]).expect(200)
    await patch([{ number: 'B' }]).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.contacts).toHaveLength(1)
    expect(res.body.data.hr.contacts[0].number).toBe('B')
  })

  it('leaves them alone when the field is omitted entirely', async () => {
    // The dangerous case: someone updating only an address must not silently
    // wipe every phone number on the record.
    const { employee } = await seedEmployee()
    const { token } = await makeUser({ email: 'c3@t.local', permissions: ALL_PERMISSIONS })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, {
      contacts: [{ number: '0917 555 1234', label: 'Globe' }],
    }).expect(200)
    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, {
      address: 'somewhere else',
    }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.contacts).toHaveLength(1)
  })

  it('clears them when given an empty list', async () => {
    // Distinct from omitting: an explicit [] means "this person has none".
    const { employee } = await seedEmployee()
    const { token } = await makeUser({ email: 'c4@t.local', permissions: ALL_PERMISSIONS })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, {
      contacts: [{ number: '0917 555 1234' }],
    }).expect(200)
    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, { contacts: [] }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.contacts).toEqual([])
  })

  it('refuses a blank number', async () => {
    const { employee } = await seedEmployee()
    const { token } = await makeUser({ email: 'c5@t.local', permissions: ALL_PERMISSIONS })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, {
      contacts: [{ number: '   ' }],
    }).expect(400)
  })

  it('is not visible without hr:read', async () => {
    const { employee } = await seedEmployee()
    const { token: owner } = await makeUser({ email: 'c6@t.local', permissions: ALL_PERMISSIONS })
    await as(owner).patch(`/api/admin/employees/${employee.id}/hr`, {
      contacts: [{ number: '0917 555 9999', label: 'Globe' }],
    }).expect(200)

    const { token } = await makeUser({ email: 'c7@t.local', permissions: ['employees:read'] })
    const res = await as(token).get('/api/admin/employees').expect(200)
    expect(JSON.stringify(res.body)).not.toContain('0917 555 9999')
  })
})

describe('branch records — permits, utilities and lease are separate keys', () => {
  async function seedBranch() {
    const branch = await prisma.branch.create({
      data: {
        name: 'Toril', lessorName: 'Sy Realty Inc.', lessorContact: '0917 555 0100',
        address: 'Quimpo Blvd, Davao City',
      },
    })
    await prisma.branchPermit.create({
      data: { branchId: branch.id, type: 'MAYORS_PERMIT', number: '2026-0041234', expiresOn: new Date('2026-12-31T00:00:00Z') },
    })
    await prisma.branchRent.create({
      data: { branchId: branch.id, amountCents: 3000000, effectiveFrom: new Date('2025-06-01T00:00:00Z') },
    })
    const account = await prisma.branchUtilityAccount.create({
      data: { branchId: branch.id, type: 'ELECTRIC', provider: 'Davao Light', accountNumber: 'DL-449120' },
    })
    await prisma.branchUtilityBill.create({
      data: {
        accountId: account.id, amountCents: 2610000, consumption: 2950,
        periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-31T00:00:00Z'),
      },
    })
    return branch
  }

  it('gives branches:read none of the three sections', async () => {
    const branch = await seedBranch()
    const { token } = await makeUser({ email: 'b1@t.local', permissions: ['branches:read'] })

    const res = await as(token).get(`/api/admin/branches/${branch.id}`).expect(200)
    expect(res.body.data).not.toHaveProperty('permits')
    expect(res.body.data).not.toHaveProperty('utilities')
    expect(res.body.data).not.toHaveProperty('lease')

    const raw = JSON.stringify(res.body)
    for (const secret of ['Sy Realty', '0917 555 0100', '2026-0041234', 'DL-449120', '2950']) {
      expect(raw).not.toContain(secret)
    }
  })

  it('gives permits without lease or utilities', async () => {
    const branch = await seedBranch()
    const { token } = await makeUser({
      email: 'b2@t.local',
      permissions: ['branches:read', 'branches:permits:read'],
    })

    const res = await as(token).get(`/api/admin/branches/${branch.id}`).expect(200)
    expect(res.body.data.permits).toHaveLength(1)
    expect(res.body.data).not.toHaveProperty('lease')
    expect(res.body.data).not.toHaveProperty('utilities')
  })

  it('gives utilities without lease — a manager can chase a bill without seeing the rent', async () => {
    const branch = await seedBranch()
    const { token } = await makeUser({
      email: 'b3@t.local',
      permissions: ['branches:read', 'branches:utilities:read'],
    })

    const res = await as(token).get(`/api/admin/branches/${branch.id}`).expect(200)
    expect(res.body.data.utilities[0].bills).toHaveLength(1)
    expect(res.body.data).not.toHaveProperty('lease')
    expect(JSON.stringify(res.body)).not.toContain('Sy Realty')
  })

  it('gives lease and rent only with branches:lease:read', async () => {
    const branch = await seedBranch()
    const { token } = await makeUser({
      email: 'b4@t.local',
      permissions: ['branches:read', 'branches:lease:read'],
    })

    const res = await as(token).get(`/api/admin/branches/${branch.id}`).expect(200)
    expect(res.body.data.lease.lessorName).toBe('Sy Realty Inc.')
    expect(res.body.data.rentHistory).toHaveLength(1)
  })

  it('never puts the lease in the LIST, for anyone', async () => {
    await seedBranch()
    const { token } = await makeUser({ email: 'b5@t.local', permissions: ALL_PERMISSIONS })

    const res = await as(token).get('/api/admin/branches').expect(200)
    expect(res.body.data[0]).not.toHaveProperty('lease')
    expect(res.body.data[0]).not.toHaveProperty('utilities')
    // Permits DO belong on the list: a lapsed one should be visible without
    // opening anything.
    expect(res.body.data[0].permits).toHaveLength(1)
  })

  it('refuses each write to whoever lacks its key', async () => {
    const branch = await seedBranch()
    const { token } = await makeUser({
      email: 'b6@t.local',
      permissions: ['branches:read', 'branches:write'],
    })

    await as(token).patch(`/api/admin/branches/${branch.id}/lease`, { lessorName: 'x' }).expect(403)
    await as(token).post(`/api/admin/branches/${branch.id}/permits`, { type: 'ZONING_CLEARANCE' }).expect(403)
    await as(token).post(`/api/admin/branches/${branch.id}/rent`, { amountCents: 1, effectiveFrom: '2027-01-01' }).expect(403)
    await as(token).post(`/api/admin/branches/${branch.id}/utilities`, { type: 'WATER' }).expect(403)
  })
})

describe('unauthenticated access', () => {
  it('refuses every admin endpoint without a token', async () => {
    const { request, app } = await import('../../test/harness')
    for (const url of ['/api/admin/employees', '/api/admin/branches', '/api/admin/dsir']) {
      await request(app).get(url).expect(401)
    }
  })
})
