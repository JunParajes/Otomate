import ExcelJS from 'exceljs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Test } from 'supertest'
import {
  as, assertTestDatabase, makeUser, migrate, positionId, prisma, syncPermissions, syncPositions,
  truncateAll,
} from '../../test/harness'

/**
 * The workbook, read back.
 *
 * Asserting the bytes are a valid xlsx proves almost nothing — what matters is
 * that the cells say what the grid says. So every test here opens the file it
 * just generated and reads the cells out of it.
 */

const THU = '2026-08-27'

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

/** supertest decodes text by default; a spreadsheet has to come back as bytes. */
const asBinary = (test: Test) =>
  test.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => cb(null, Buffer.concat(chunks)))
  })

async function openWorkbook(body: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(body as unknown as ArrayBuffer)
  return workbook
}

async function seed() {
  const home = await prisma.branch.create({ data: { name: 'Bangkerohan', abbreviation: 'BANK' } })
  const other = await prisma.branch.create({ data: { name: 'TRD Puan', abbreviation: 'TRD' } })
  const pos = await positionId('Baker')
  const a = await prisma.employee.create({
    data: { firstName: 'Ana', middleName: 'Santos', lastName: 'Reyes', positionId: pos, branchId: home.id },
  })
  const b = await prisma.employee.create({
    data: { firstName: 'Ben', lastName: 'Dorilag', positionId: pos, branchId: other.id },
  })
  const { token } = await makeUser({
    email: `x${Math.random()}@t.local`,
    permissions: ['employees:read', 'schedule:read', 'schedule:write', 'schedule:approve'],
  })
  const made = await as(token).post('/api/admin/work-schedule', { weekStart: THU }).expect(201)
  return { id: made.body.data.id as string, a, b, home, other, token }
}

describe('exporting the work schedule', () => {
  it('gives one sheet per branch, named after the branch', async () => {
    const { id, token } = await seed()
    const res = await asBinary(as(token).get(`/api/admin/work-schedule/${id}/export?branch=ALL`)).expect(200)

    expect(res.headers['content-type']).toContain('spreadsheetml')
    expect(res.headers['content-disposition']).toContain('.xlsx')

    const workbook = await openWorkbook(res.body)
    expect(workbook.worksheets.map(w => w.name).sort()).toEqual(['Bangkerohan', 'TRD Puan'])
  })

  it('narrows to a single branch when one is asked for', async () => {
    const { id, home, token } = await seed()
    const res = await asBinary(
      as(token).get(`/api/admin/work-schedule/${id}/export?branch=${home.id}`)
    ).expect(200)

    const workbook = await openWorkbook(res.body)
    expect(workbook.worksheets.map(w => w.name)).toEqual(['Bangkerohan'])
    expect(res.headers['content-disposition']).toContain('Bangkerohan')
  })

  /** The marks are the whole point — if these drift the file is worse than useless. */
  it('writes the same marks the grid shows', async () => {
    const { id, a, other, token } = await seed()
    await as(token).patch(`/api/admin/work-schedule/${id}/entries`, {
      entries: [
        { employeeId: a.id, day: '2026-08-27', status: 'OFF' },
        { employeeId: a.id, day: '2026-08-28', status: 'NOT_SCHEDULED' },
        { employeeId: a.id, day: '2026-08-29', status: 'OPENER' },
        { employeeId: a.id, day: '2026-08-30', status: 'CLOSER' },
        { employeeId: a.id, day: '2026-08-31', status: 'FRONTLINE' },
        // Lent to another branch: the cell shows THAT branch's short name.
        { employeeId: a.id, day: '2026-09-01', status: 'SCHEDULED', assignedBranchId: other.id },
      ],
    }).expect(200)

    const res = await asBinary(as(token).get(`/api/admin/work-schedule/${id}/export?branch=ALL`)).expect(200)
    const sheet = (await openWorkbook(res.body)).getWorksheet('Bangkerohan')!

    // Find the row by the filed name the grid uses.
    let row: ExcelJS.Row | undefined
    sheet.eachRow(r => { if (String(r.getCell(1).value ?? '').startsWith('Reyes, Ana')) row = r })
    expect(row, 'the employee row is in the sheet').toBeDefined()

    expect(row!.getCell(3).value).toBe('Off')
    expect(row!.getCell(4).value).toBe('✗')
    expect(row!.getCell(5).value).toBe('Op')
    expect(row!.getCell(6).value).toBe('Cl')
    expect(row!.getCell(7).value).toBe('FL')
    expect(row!.getCell(8).value).toBe('TRD')
    expect(row!.getCell(9).value).toBe('✓')
  })

  it('carries the header, signature blocks and the printed footer', async () => {
    const { id, token } = await seed()
    const res = await asBinary(as(token).get(`/api/admin/work-schedule/${id}/export?branch=ALL`)).expect(200)
    const sheet = (await openWorkbook(res.body)).getWorksheet('Bangkerohan')!

    const text: string[] = []
    sheet.eachRow(r => r.eachCell(c => text.push(String(c.value ?? ''))))
    const all = text.join(' | ')

    expect(all).toContain('Work Schedule')
    expect(all).toContain('Bangkerohan')
    expect(all).toContain('WS-35')
    expect(all).toContain('Prepared by')
    expect(all).toContain('Approved by')
    expect(all).toContain('Printed')
    // Not approved yet, so it must say so.
    expect(all).toContain('NOT YET APPROVED')
  })

  /**
   * A spreadsheet is the easiest thing in the world to forward, so it must not
   * become a side door around the HR permission.
   */
  it('contains no remarks, covers or pairings', async () => {
    const { id, a, b, token } = await seed()
    await as(token).patch(`/api/admin/work-schedule/${id}/entries`, {
      entries: [{
        employeeId: a.id, day: THU, status: 'OFF', coveredById: b.id,
        remarks: 'Clinic appointment, asked in advance',
      }],
    }).expect(200)

    const res = await asBinary(as(token).get(`/api/admin/work-schedule/${id}/export?branch=ALL`)).expect(200)
    const workbook = await openWorkbook(res.body)
    const text: string[] = []
    for (const sheet of workbook.worksheets) {
      sheet.eachRow(r => r.eachCell(c => text.push(String(c.value ?? ''))))
    }
    const all = text.join(' | ')

    expect(all).not.toContain('Clinic appointment')
    expect(all).not.toContain('Covered')

    /*
     * The cover's NAME cannot simply be searched for — Ben is also a member of
     * staff and appears as a row of his own, which is not a leak. What matters
     * is that the covered day renders as the mark alone.
     */
    const sheet = workbook.getWorksheet('Bangkerohan')!
    let row: ExcelJS.Row | undefined
    sheet.eachRow(r => { if (String(r.getCell(1).value ?? '').startsWith('Reyes, Ana')) row = r })
    expect(row!.getCell(3).value).toBe('Off')
  })

  it('exports an approved schedule the same as a draft — reading is not editing', async () => {
    const { id, token } = await seed()
    await as(token).patch(`/api/admin/work-schedule/${id}`, { status: 'APPROVED' }).expect(200)

    const res = await asBinary(as(token).get(`/api/admin/work-schedule/${id}/export?branch=ALL`)).expect(200)
    const sheet = (await openWorkbook(res.body)).getWorksheet('Bangkerohan')!
    const text: string[] = []
    sheet.eachRow(r => r.eachCell(c => text.push(String(c.value ?? ''))))
    expect(text.join(' | ')).not.toContain('NOT YET APPROVED')
  })

  it('needs schedule:read', async () => {
    const { id } = await seed()
    const { token } = await makeUser({ email: 'none@t.local', permissions: ['employees:read'] })
    await as(token).get(`/api/admin/work-schedule/${id}/export?branch=ALL`).expect(403)
  })

  it('refuses a branch that is not in this cutoff', async () => {
    const { id, token } = await seed()
    const stranger = await prisma.branch.create({ data: { name: 'Elsewhere' } })
    await as(token).get(`/api/admin/work-schedule/${id}/export?branch=${stranger.id}`).expect(404)
  })
})
