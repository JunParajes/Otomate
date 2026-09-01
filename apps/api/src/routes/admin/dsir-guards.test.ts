import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS, as, assertTestDatabase, makeUser, migrate, prisma, syncPermissions, truncateAll,
} from '../../test/harness'

/**
 * The DSIR guards, and the coupling behind them.
 *
 * Sales are derived from stock movement and drive the variance deducted from a
 * cashier's wages (docs/DOMAIN.md), so a report changing after it is closed is
 * not a display bug. These were hand-run against a disposable stack; now they
 * are not.
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

async function scenario() {
  const { token } = await makeUser({ email: 'dsir@t.local', permissions: ALL_PERMISSIONS })
  const a = await prisma.branch.create({ data: { name: 'Branch A' } })
  const b = await prisma.branch.create({ data: { name: 'Branch B' } })
  const category = await prisma.category.create({ data: { name: 'Breads' } })
  const product = await prisma.product.create({
    data: { name: 'Pandesal', categoryId: category.id, priceCents: 300, unit: 'PIECE' },
  })
  return { token, a, b, product }
}

/** Branch B: 100 produced, 40 left, plus whatever A sends it. */
async function reportForB(token: string, bId: string, productId: string, date: string) {
  const created = await as(token).post('/api/admin/dsir', { branchId: bId, reportDate: date }).expect(201)
  const id = created.body.data.id
  await as(token).put(`/api/admin/dsir/${id}`, {
    usesCharges: false, usesPullOuts: false, usesTransfers: false, usesOverEnd: false,
    lines: [{ productId, begBal: 0, produced: 100, overEnd: 0, pulledOut: 0, endBal: 40 }],
    charges: [], transfers: [], collections: [],
  }).expect(200)
  return id
}

/** Branch A: a draft that sends 20 units to B. */
async function draftForA(token: string, aId: string, bId: string, productId: string, date: string) {
  const created = await as(token).post('/api/admin/dsir', { branchId: aId, reportDate: date }).expect(201)
  const id = created.body.data.id
  await as(token).put(`/api/admin/dsir/${id}`, {
    usesCharges: false, usesPullOuts: false, usesTransfers: true, usesOverEnd: false,
    lines: [{ productId, begBal: 0, produced: 50, overEnd: 0, pulledOut: 0, endBal: 10 }],
    charges: [], transfers: [{ productId, toBranchId: bId, quantity: 20 }], collections: [],
  }).expect(200)
  return id
}

describe('deleting a draft', () => {
  it('deletes a plain draft and everything under it', async () => {
    const { token, a, b, product } = await scenario()
    const id = await draftForA(token, a.id, b.id, product.id, '2026-08-21')

    await as(token).delete(`/api/admin/dsir/${id}`).expect(200)
    await as(token).get(`/api/admin/dsir/${id}`).expect(404)
    expect(await prisma.dsirLine.count()).toBe(0)
    expect(await prisma.dsirTransfer.count()).toBe(0)
  })

  it('refuses a transfer from a branch to itself', async () => {
    // Would inflate that branch's own available stock out of nothing.
    const { token, a, product } = await scenario()
    const created = await as(token)
      .post('/api/admin/dsir', { branchId: a.id, reportDate: '2026-08-22' })
      .expect(201)

    const res = await as(token).put(`/api/admin/dsir/${created.body.data.id}`, {
      usesCharges: false, usesPullOuts: false, usesTransfers: true, usesOverEnd: false,
      lines: [{ productId: product.id, begBal: 0, produced: 50, overEnd: 0, pulledOut: 0, endBal: 10 }],
      charges: [], transfers: [{ productId: product.id, toBranchId: a.id, quantity: 20 }], collections: [],
    }).expect(400)
    expect(res.body.error.message).toContain('cannot transfer stock to itself')
  })

  it('refuses to delete a finalised report', async () => {
    const { token, a, b, product } = await scenario()
    const id = await reportForB(token, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${id}/finalize`).expect(200)

    const res = await as(token).delete(`/api/admin/dsir/${id}`).expect(409)
    expect(res.body.error.code).toBe('REPORT_FINALIZED')
    void a
  })

  it('refuses when the draft sends stock to a branch whose report is finalised', async () => {
    // Not because the figures would move — the receiver is frozen now — but
    // because it would leave a closed report claiming stock from a report that
    // no longer exists.
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)

    const res = await as(token).delete(`/api/admin/dsir/${aDraft}`).expect(409)
    expect(res.body.error.code).toBe('RECEIVER_FINALIZED')
    expect(res.body.error.message).toContain('Branch B')
  })

  it("leaves the finalised report's sales untouched after a refused delete", async () => {
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)

    const before = (await as(token).get(`/api/admin/dsir/${bReport}`).expect(200)).body.data.salesCents
    const aDraft = (await as(token).get('/api/admin/dsir').expect(200)).body.data
      .find((r: { branch: { name: string } }) => r.branch.name === 'Branch A').id
    await as(token).delete(`/api/admin/dsir/${aDraft}`).expect(409)

    const after = (await as(token).get(`/api/admin/dsir/${bReport}`).expect(200)).body.data.salesCents
    expect(after).toBe(before)
  })

  it('allows the delete once the receiver is reopened — the escape hatch', async () => {
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)
    await as(token).post(`/api/admin/dsir/${bReport}/reopen`).expect(200)

    await as(token).delete(`/api/admin/dsir/${aDraft}`).expect(200)
  })

  it('allows the delete when the receiving report is still a draft', async () => {
    const { token, a, b, product } = await scenario()
    await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')

    await as(token).delete(`/api/admin/dsir/${aDraft}`).expect(200)
  })
})

describe('a finalised report is frozen (OPERATIONS.md gap 0)', () => {
  /**
   * This block used to hold a characterisation test asserting the WRONG
   * behaviour — an edit to a sending report moved a closed report's sales from
   * ₱240.00 to ₱195.00 — pinned so that a fix would announce itself by failing.
   * This is that fix, and these are the assertions that replaced it.
   */
  const cutTransferTo5 = (token: string, aDraft: string, bId: string, productId: string, qty = 5) =>
    as(token).put(`/api/admin/dsir/${aDraft}`, {
      usesCharges: false, usesPullOuts: false, usesTransfers: true, usesOverEnd: false,
      lines: [{ productId, begBal: 0, produced: 50, overEnd: 0, pulledOut: 0, endBal: 10 }],
      charges: [], transfers: [{ productId, toBranchId: bId, quantity: qty }], collections: [],
    })

  it('holds its sales when the sender is edited afterwards', async () => {
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)

    // 0 opening + 100 produced + 20 received - 40 left = 80 sold at ₱3.00
    expect((await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.salesCents).toBe(24000)

    await cutTransferTo5(token, aDraft, b.id, product.id).expect(200)

    const after = (await as(token).get(`/api/admin/dsir/${bReport}`).expect(200)).body.data
    expect(after.status).toBe('FINALIZED')
    expect(after.salesCents).toBe(24000)
    expect(
      after.inboundTransfers.reduce((n: number, t: { quantity: number }) => n + t.quantity, 0)
    ).toBe(20)
  })

  it('holds its sales in the LIST too, not just on the report', async () => {
    // The list is where a variance gets noticed, so the two must agree.
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)
    await cutTransferTo5(token, aDraft, b.id, product.id).expect(200)

    const row = (await as(token).get('/api/admin/dsir').expect(200)).body.data
      .find((r: { id: string }) => r.id === bReport)
    expect(row.salesCents).toBe(24000)
  })

  it('still tracks the sender while it is a DRAFT', async () => {
    // Freezing must not start early: two open reports should agree, which is the
    // whole reason a transfer is entered once by the sender.
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')

    expect((await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.salesCents).toBe(24000)
    await cutTransferTo5(token, aDraft, b.id, product.id).expect(200)
    // 0 + 100 + 5 - 40 = 65 sold
    expect((await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.salesCents).toBe(19500)
  })

  it('tracks again when reopened, and re-freezes at the new truth', async () => {
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    const aDraft = await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)
    await cutTransferTo5(token, aDraft, b.id, product.id).expect(200)
    expect((await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.salesCents).toBe(24000)

    await as(token).post(`/api/admin/dsir/${bReport}/reopen`).expect(200)
    expect((await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.salesCents).toBe(19500)

    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)
    await cutTransferTo5(token, aDraft, b.id, product.id, 1).expect(200)
    // Frozen at 5, not back at the original 20.
    expect((await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.salesCents).toBe(19500)
  })

  it('keeps the source branch on each frozen row, so the record still reads', async () => {
    const { token, a, b, product } = await scenario()
    const bReport = await reportForB(token, b.id, product.id, '2026-08-20')
    await draftForA(token, a.id, b.id, product.id, '2026-08-20')
    await as(token).post(`/api/admin/dsir/${bReport}/finalize`).expect(200)

    const rows = (await as(token).get(`/api/admin/dsir/${bReport}`)).body.data.inboundTransfers
    expect(rows).toHaveLength(1)
    expect(rows[0].fromBranchName).toBe('Branch A')
    expect(rows[0].productName).toBe('Pandesal')
    expect(rows[0].quantity).toBe(20)
  })
})

describe('dates survive the round trip', () => {
  it('returns the date that was sent, not the day before', async () => {
    // toISOString() converts to UTC first, so a date stored as the 1st comes
    // back as the 31st for anyone east of Greenwich — which is everyone here.
    const { token } = await makeUser({ email: 'dates@t.local', permissions: ALL_PERMISSIONS })
    const branch = await prisma.branch.create({ data: { name: 'Dates' } })
    const employee = await prisma.employee.create({
      data: { firstName: 'A', lastName: 'B', branchId: branch.id },
    })

    await as(token).patch(`/api/admin/employees/${employee.id}/hr`, {
      dateHired: '2026-03-01', birthDate: '1998-07-14', probationEndDate: '2026-08-31',
    }).expect(200)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.hr.dateHired).toBe('2026-03-01')
    expect(res.body.data.hr.birthDate).toBe('1998-07-14')
    expect(res.body.data.hr.probationEndDate).toBe('2026-08-31')
  })

  it('keeps a rent start date exact', async () => {
    const { token } = await makeUser({ email: 'dates2@t.local', permissions: ALL_PERMISSIONS })
    const branch = await prisma.branch.create({ data: { name: 'Rent' } })

    await as(token).post(`/api/admin/branches/${branch.id}/rent`, {
      amountCents: 3000000, effectiveFrom: '2025-06-01',
    }).expect(201)

    const res = await as(token).get(`/api/admin/branches/${branch.id}`).expect(200)
    expect(res.body.data.rentHistory[0].effectiveFrom).toBe('2025-06-01')
  })
})

describe('effective-dated records correct rather than duplicate', () => {
  it('re-entering a salary start date updates that row', async () => {
    const { token } = await makeUser({ email: 'sal@t.local', permissions: ALL_PERMISSIONS })
    const employee = await prisma.employee.create({ data: { firstName: 'A', lastName: 'B' } })

    const post = (basicCents: number) =>
      as(token).post(`/api/admin/employees/${employee.id}/salary`, {
        basicCents, effectiveFrom: '2026-03-01', rateType: 'DAILY',
      })
    await post(40000).expect(201)
    await post(41000).expect(201)

    const res = await as(token).get(`/api/admin/employees/${employee.id}`).expect(200)
    expect(res.body.data.salaryHistory).toHaveLength(1)
    expect(res.body.data.salaryHistory[0].basicCents).toBe(41000)
  })

  it('re-entering a utility bill period updates that bill', async () => {
    const { token } = await makeUser({ email: 'bill@t.local', permissions: ALL_PERMISSIONS })
    const branch = await prisma.branch.create({ data: { name: 'Bills' } })
    const created = await as(token)
      .post(`/api/admin/branches/${branch.id}/utilities`, { type: 'ELECTRIC' })
      .expect(201)
    const accountId = created.body.data.utilities[0].id

    const post = (amountCents: number) =>
      as(token).post(`/api/admin/branches/${branch.id}/utilities/${accountId}/bills`, {
        periodStart: '2026-08-01', periodEnd: '2026-08-31', amountCents,
      })
    await post(2610000).expect(201)
    await post(2650000).expect(201)

    const res = await as(token).get(`/api/admin/branches/${branch.id}`).expect(200)
    expect(res.body.data.utilities[0].bills).toHaveLength(1)
    expect(res.body.data.utilities[0].bills[0].amountCents).toBe(2650000)
  })
})
