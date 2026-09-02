import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  as, assertTestDatabase, makeUser, migrate, positionId, prisma, syncPermissions, syncPositions,
  truncateAll,
} from '../../test/harness'

/**
 * The 201 file round-trip.
 *
 * The point of testing this rather than trusting the schema is the round-trip
 * itself: these fields go out as YYYY-MM-DD strings and are stored as dates, and
 * height/weight go out as numbers through a form that holds everything else as
 * text. Both are places a value can quietly change shape between the screen and
 * the database.
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
    data: { firstName: 'Maria', lastName: 'Cruz', positionId: await positionId('Cashier') },
  })
  const { token } = await makeUser({
    email: 'hr@t.local',
    permissions: ['employees:read', 'hr:read', 'hr:write'],
  })
  return { employee, token }
}

describe('PATCH /employees/:id/hr — the added 201 fields', () => {
  it('stores and returns every new field unchanged', async () => {
    const { employee, token } = await seed()

    const res = await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({
        email: 'maria@example.com',
        gender: 'FEMALE',
        birthDate: '1998-04-20',
        birthPlace: 'Davao City',
        religion: 'Roman Catholic',
        heightCm: 158,
        weightGrams: 62500,
        educationLevel: 'COLLEGE',
        educationDetail: 'BS Hotel and Restaurant Management',
        remarks: 'Transferred from Matina.',
        confidentialityAgreementOn: '2026-01-15',
        authorityToDeductOn: '2026-01-15',
        birthCertificateOn: '2026-02-01',
        marriageContractOn: null,
        probationExtendedTo: '2026-11-01',
        probationExtensionReason: 'One month more on uniform hygiene.',
      })
      .expect(200)

    const hr = res.body.data.hr
    expect(hr.email).toBe('maria@example.com')
    expect(hr.gender).toBe('FEMALE')
    expect(hr.birthPlace).toBe('Davao City')
    expect(hr.religion).toBe('Roman Catholic')
    expect(hr.heightCm).toBe(158)
    // Exact, because it is an integer count of grams and never a float.
    expect(hr.weightGrams).toBe(62500)
    expect(hr.educationLevel).toBe('COLLEGE')
    expect(hr.educationDetail).toBe('BS Hotel and Restaurant Management')
    expect(hr.remarks).toBe('Transferred from Matina.')
    expect(hr.probationExtensionReason).toBe('One month more on uniform hygiene.')
  })

  /**
   * The failure this guards against: a date stored at midnight UTC and read back
   * in Davao (UTC+8) reads as the previous day. A hire date that walks backwards
   * one day per save is the kind of bug nobody notices until payroll.
   */
  it('returns dates as the same day they were sent', async () => {
    const { employee, token } = await seed()
    const res = await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({
        birthDate: '1998-04-20',
        confidentialityAgreementOn: '2026-01-15',
        birthCertificateOn: '2026-02-01',
        probationExtendedTo: '2026-11-01',
      })
      .expect(200)

    expect(res.body.data.hr.birthDate).toBe('1998-04-20')
    expect(res.body.data.hr.confidentialityAgreementOn).toBe('2026-01-15')
    expect(res.body.data.hr.birthCertificateOn).toBe('2026-02-01')
    expect(res.body.data.hr.probationExtendedTo).toBe('2026-11-01')
  })

  it('leaves untouched fields alone — an omitted field is not a cleared one', async () => {
    const { employee, token } = await seed()
    await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({ religion: 'Iglesia ni Cristo', heightCm: 165 })
      .expect(200)

    // A later save of only the address must not wipe what came before.
    const res = await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({ address: '12 Rizal St' })
      .expect(200)

    expect(res.body.data.hr.religion).toBe('Iglesia ni Cristo')
    expect(res.body.data.hr.heightCm).toBe(165)
  })

  it('clears a field sent as null, and treats an empty string the same way', async () => {
    const { employee, token } = await seed()
    await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({ email: 'maria@example.com', remarks: 'note' })
      .expect(200)

    const res = await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({ email: '', remarks: null })
      .expect(200)

    expect(res.body.data.hr.email).toBeNull()
    expect(res.body.data.hr.remarks).toBeNull()
  })

  it('refuses a malformed email rather than storing it', async () => {
    const { employee, token } = await seed()
    await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({ email: 'maria at example dot com' })
      .expect(400)

    const stored = await prisma.employee.findUnique({ where: { id: employee.id } })
    expect(stored?.email).toBeNull()
  })

  it('keeps the new fields behind hr:read, like the rest of the 201 file', async () => {
    const { employee, token } = await seed()
    await as(token)
      .patch(`/api/admin/employees/${employee.id}/hr`)
      .send({ religion: 'Roman Catholic', heightCm: 158 })
      .expect(200)

    const { token: plain } = await makeUser({ email: 'plain@t.local', permissions: ['employees:read'] })
    const res = await as(plain).get(`/api/admin/employees/${employee.id}`).expect(200)
    // The whole section is absent — not present with the values nulled.
    expect(res.body.data).not.toHaveProperty('hr')
    expect(JSON.stringify(res.body)).not.toContain('Roman Catholic')
  })
})
