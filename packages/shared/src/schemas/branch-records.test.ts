import { describe, expect, it } from 'vitest'
import {
  billStatus, branchPermitStatus, consumptionChange, currentRent, leaseStatus,
  permitName, permitStatus, unpaidSummary,
  type BranchPermitRecord, type UtilityAccountRecord, type UtilityBillRecord,
} from './branch-records.js'

const TODAY = '2026-08-30'

const permit = (over: Partial<BranchPermitRecord>): BranchPermitRecord => ({
  id: 'p', type: 'MAYORS_PERMIT', label: null, number: null,
  issuedOn: null, expiresOn: null, authority: null, note: null, ...over,
})

const bill = (over: Partial<UtilityBillRecord>): UtilityBillRecord => ({
  id: 'b', periodStart: '2026-08-01', periodEnd: '2026-08-31', amountCents: 100000,
  dueDate: null, paidOn: null, consumption: null, referenceNo: null, note: null, ...over,
})

const account = (bills: UtilityBillRecord[]): UtilityAccountRecord => ({
  id: 'a', type: 'ELECTRIC', label: null, provider: null, accountNumber: null,
  meterNumber: null, isActive: true, bills,
})

describe('permitStatus', () => {
  it('warns 60 days out, not 30 — a city-office renewal needs the notice', () => {
    expect(permitStatus(permit({ expiresOn: '2026-10-15' }), TODAY).state).toBe('due')
    expect(permitStatus(permit({ expiresOn: '2026-12-01' }), TODAY).state).toBe('none')
  })

  it('reports an expired permit as overdue', () => {
    expect(permitStatus(permit({ expiresOn: '2026-01-19' }), TODAY)).toEqual({
      state: 'overdue', daysLeft: -223,
    })
  })

  it('is silent when no expiry was recorded', () => {
    // Unknown, not fine. The UI marks these separately rather than implying they
    // are current.
    expect(permitStatus(permit({}), TODAY).state).toBe('none')
  })
})

describe('branchPermitStatus', () => {
  it('reports the worst state, since a row has room for one signal', () => {
    const r = branchPermitStatus(
      [permit({ id: '1', expiresOn: '2026-01-19' }), permit({ id: '2', expiresOn: '2026-09-15' })],
      TODAY
    )
    expect(r).toEqual({ state: 'overdue', count: 1 })
  })

  it('falls back to due when nothing has expired yet', () => {
    expect(branchPermitStatus([permit({ expiresOn: '2026-09-15' })], TODAY)).toEqual({
      state: 'due', count: 1,
    })
  })

  it('is clear when every permit is current', () => {
    expect(branchPermitStatus([permit({ expiresOn: '2027-06-01' })], TODAY)).toEqual({
      state: 'none', count: 0,
    })
  })

  it('is clear for a branch with no permits recorded', () => {
    expect(branchPermitStatus([], TODAY).state).toBe('none')
  })
})

describe('permitName', () => {
  it('uses the type for a known permit', () => {
    expect(permitName(permit({ type: 'SANITARY_PERMIT' }))).toBe('Sanitary Permit')
  })

  it('uses the free label for OTHER', () => {
    expect(permitName(permit({ type: 'OTHER', label: 'CENRO Clearance' }))).toBe('CENRO Clearance')
  })

  it('never renders an empty name', () => {
    expect(permitName(permit({ type: 'OTHER', label: '  ' }))).toBe('Other permit')
  })
})

describe('billStatus', () => {
  it('is paid once settled, however late it was', () => {
    // Nagging about a bill already paid trains people to ignore the warnings.
    const b = bill({ dueDate: '2026-07-01', paidOn: '2026-08-15' })
    expect(billStatus(b, TODAY).state).toBe('paid')
  })

  it('warns 7 days out — this is one payment, not a renewal process', () => {
    expect(billStatus(bill({ dueDate: '2026-09-04' }), TODAY).state).toBe('due')
    expect(billStatus(bill({ dueDate: '2026-09-20' }), TODAY).state).toBe('none')
  })

  it('reports an unpaid bill past its date as overdue', () => {
    expect(billStatus(bill({ dueDate: '2026-08-05' }), TODAY)).toEqual({
      state: 'overdue', daysLeft: -25,
    })
  })
})

describe('unpaidSummary', () => {
  /**
   * REGRESSION. An earlier version counted only bills past a due date, so an
   * unpaid bill with no due date recorded vanished from the total — a ₱26,500
   * electricity bill sat unpaid while the badge read "1 unpaid · ₱3,400".
   * Caught by eye on the rendered page, not by any check.
   */
  it('counts an unpaid bill that has no due date', () => {
    const r = unpaidSummary([account([
      bill({ id: 'no-date', amountCents: 2650000 }),          // unpaid, no due date
      bill({ id: 'overdue', amountCents: 340000, dueDate: '2026-08-05' }),
    ])], TODAY)
    expect(r.count).toBe(2)
    expect(r.totalCents).toBe(2990000)
    expect(r.overdueCount).toBe(1)
    expect(r.state).toBe('overdue')
  })

  it('separates how many are unpaid from how many are overdue', () => {
    // The badge and the disconnection warning say different things and must not
    // be driven by the same number.
    const r = unpaidSummary([account([
      bill({ id: '1', amountCents: 100 }),
      bill({ id: '2', amountCents: 200, dueDate: '2026-08-01' }),
      bill({ id: '3', amountCents: 400, paidOn: '2026-08-10' }),
    ])], TODAY)
    expect(r.count).toBe(2)
    expect(r.overdueCount).toBe(1)
    expect(r.totalCents).toBe(300)
  })

  it('reports unpaid-but-not-urgent distinctly from clear', () => {
    const r = unpaidSummary([account([bill({ amountCents: 500 })])], TODAY)
    expect(r.state).toBe('unpaid')
    expect(r.count).toBe(1)
  })

  it('is clear when everything is paid', () => {
    const r = unpaidSummary([account([bill({ paidOn: '2026-08-02' })])], TODAY)
    expect(r).toEqual({ state: 'none', count: 0, overdueCount: 0, totalCents: 0 })
  })

  it('adds up across accounts', () => {
    const r = unpaidSummary(
      [account([bill({ id: 'e', amountCents: 1000 })]), account([bill({ id: 'w', amountCents: 250 })])],
      TODAY
    )
    expect(r.count).toBe(2)
    expect(r.totalCents).toBe(1250)
  })
})

describe('consumptionChange', () => {
  const bills = [
    bill({ id: 'now', periodStart: '2026-08-01', consumption: 2950 }),
    bill({ id: 'last-month', periodStart: '2026-07-01', consumption: 2180 }),
    bill({ id: 'year-ago', periodStart: '2025-08-01', consumption: 2100 }),
  ]

  it('compares with the same month a year earlier, not last month', () => {
    // Usage is seasonal. Against July this would flag every summer; against last
    // August it means a failing compressor or a door left open.
    const c = consumptionChange(bills, bills[0]!)
    expect(c).toEqual({ percent: 40, previous: 2100 })
  })

  it('tolerates billing periods that drift by a few days', () => {
    const drifted = [
      bill({ id: 'now', periodStart: '2026-08-01', consumption: 200 }),
      bill({ id: 'year-ago', periodStart: '2025-08-09', consumption: 100 }),
    ]
    expect(consumptionChange(drifted, drifted[0]!)?.percent).toBe(100)
  })

  it('does not reach for a period that is not close to a year back', () => {
    const far = [
      bill({ id: 'now', periodStart: '2026-08-01', consumption: 200 }),
      bill({ id: 'old', periodStart: '2025-05-01', consumption: 100 }),
    ]
    expect(consumptionChange(far, far[0]!)).toBeNull()
  })

  it('returns null in the first year, when there is nothing to compare', () => {
    expect(consumptionChange([bills[0]!], bills[0]!)).toBeNull()
  })

  it('returns null when this bill has no reading', () => {
    const b = bill({ id: 'now', periodStart: '2026-08-01' })
    expect(consumptionChange([b, bills[2]!], b)).toBeNull()
  })

  it('does not divide by zero against a month of no usage', () => {
    const zero = [
      bill({ id: 'now', periodStart: '2026-08-01', consumption: 500 }),
      bill({ id: 'year-ago', periodStart: '2025-08-01', consumption: 0 }),
    ]
    expect(consumptionChange(zero, zero[0]!)).toBeNull()
  })

  it('reports a fall as negative', () => {
    const down = [
      bill({ id: 'now', periodStart: '2026-08-01', consumption: 1050 }),
      bill({ id: 'year-ago', periodStart: '2025-08-01', consumption: 2100 }),
    ]
    expect(consumptionChange(down, down[0]!)?.percent).toBe(-50)
  })
})

describe('leaseStatus', () => {
  it("uses the contract's own notice period, not a fixed window", () => {
    // A lease needing 90 days' notice has to be acted on three months out.
    const ends = { contractEnd: '2026-11-01', renewalNoticeDays: 90 }
    expect(leaseStatus(ends, TODAY).state).toBe('due')
    expect(leaseStatus({ ...ends, renewalNoticeDays: 30 }, TODAY).state).toBe('none')
  })

  it('falls back to 60 days when the contract does not say', () => {
    expect(leaseStatus({ contractEnd: '2026-10-15', renewalNoticeDays: null }, TODAY).state).toBe('due')
  })

  it('is silent with no end date recorded', () => {
    expect(leaseStatus({ contractEnd: null, renewalNoticeDays: 90 }, TODAY).state).toBe('none')
  })
})

describe('currentRent', () => {
  it('ignores a scheduled increase until its date', () => {
    const history = [
      { id: '1', amountCents: 2800000, effectiveFrom: '2024-06-01', note: null, recordedBy: null, createdAt: '' },
      { id: '2', amountCents: 3000000, effectiveFrom: '2025-06-01', note: null, recordedBy: null, createdAt: '' },
      { id: '3', amountCents: 9900000, effectiveFrom: '2027-06-01', note: null, recordedBy: null, createdAt: '' },
    ]
    expect(currentRent(history)?.amountCents).toBe(3000000)
  })

  it('returns null when no rent has been recorded', () => {
    expect(currentRent([])).toBeNull()
  })
})
