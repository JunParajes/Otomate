import { describe, expect, it } from 'vitest'
import {
  computeLineTotals, isImpossibleLine, looksLikeMissingInbound,
  type DsirLineQuantities,
} from './dsir.js'

/**
 * The DSIR arithmetic decides what a branch sold, which decides the variance,
 * which is deducted from a cashier's wages (docs/DOMAIN.md). These are the
 * numbers where being wrong costs someone money, so they are tested first.
 */

/** A line with nothing on it, so each test states only what it is about. */
const blank: DsirLineQuantities = {
  begBal: 0, produced: 0, transferredIn: 0, transferredOut: 0,
  overEnd: 0, charged: 0, pulledOut: 0, endBal: 0,
}
const line = (over: Partial<DsirLineQuantities>): DsirLineQuantities => ({ ...blank, ...over })

describe('computeLineTotals', () => {
  it('derives sales from stock movement, not from anything typed', () => {
    // 0 opening + 100 baked, 40 left ⇒ 60 sold at ₱3.00 ⇒ ₱180.00
    const t = computeLineTotals(line({ produced: 100, endBal: 40 }), 300)
    expect(t).toEqual({ preTotal: 100, sold: 60, salesCents: 18000 })
  })

  it('counts stock received from another branch as available', () => {
    const t = computeLineTotals(line({ produced: 100, transferredIn: 20, endBal: 40 }), 300)
    expect(t.preTotal).toBe(120)
    expect(t.sold).toBe(80)
  })

  it('removes stock sent to another branch — it was not sold here', () => {
    const t = computeLineTotals(line({ produced: 100, transferredOut: 20, endBal: 40 }), 300)
    expect(t.preTotal).toBe(80)
    expect(t.sold).toBe(40)
  })

  it('treats charges and pull-outs as accounted for, not sold', () => {
    // Both leave the shelf; neither is a sale. Charges are recovered via
    // payroll, pull-outs are the branch's loss.
    const t = computeLineTotals(line({ produced: 100, charged: 5, pulledOut: 3, endBal: 40 }), 300)
    expect(t.sold).toBe(52)
    expect(t.salesCents).toBe(15600)
  })

  it('adds over-end to what was available', () => {
    // Stock found beyond what the books allow is still stock that existed.
    const t = computeLineTotals(line({ produced: 100, overEnd: 10, endBal: 40 }), 300)
    expect(t.preTotal).toBe(110)
    expect(t.sold).toBe(70)
  })

  it('applies every movement together', () => {
    const t = computeLineTotals(
      line({ begBal: 12, produced: 100, transferredIn: 20, transferredOut: 5, overEnd: 3, charged: 2, pulledOut: 4, endBal: 30 }),
      2550
    )
    // available: 12 + 100 + 20 - 5 + 3 = 130 ; sold: 130 - 2 - 4 - 30 = 94
    expect(t.preTotal).toBe(130)
    expect(t.sold).toBe(94)
    expect(t.salesCents).toBe(94 * 2550)
  })

  it('keeps money in whole centavos', () => {
    // ₱25.50 x 3. A float would give 7649.999999999999 here.
    const t = computeLineTotals(line({ produced: 3, endBal: 0 }), 2550)
    expect(t.salesCents).toBe(7650)
    expect(Number.isInteger(t.salesCents)).toBe(true)
  })

  it('sells nothing when nothing moved', () => {
    expect(computeLineTotals(line({ begBal: 40, endBal: 40 }), 300)).toEqual({
      preTotal: 40, sold: 0, salesCents: 0,
    })
  })
})

describe('isImpossibleLine', () => {
  it('flags a line that closed with more stock than ever existed', () => {
    // 10 available, 25 counted at close. Arithmetically -15 sold.
    const t = computeLineTotals(line({ produced: 10, endBal: 25 }), 300)
    expect(t.sold).toBe(-15)
    expect(isImpossibleLine(t)).toBe(true)
  })

  it('does not flag an ordinary line', () => {
    expect(isImpossibleLine(computeLineTotals(line({ produced: 10, endBal: 4 }), 300))).toBe(false)
  })

  it('flags a line that is short by exactly one', () => {
    // The boundary, and the likeliest real case — someone counted one too many
    // at close. A check written as `sold < -1` passes every other test here.
    const t = computeLineTotals(line({ produced: 10, endBal: 11 }), 300)
    expect(t.sold).toBe(-1)
    expect(isImpossibleLine(t)).toBe(true)
  })

  it('does not flag a line that sold exactly everything', () => {
    // Zero is the boundary and is entirely normal — a product that sold out.
    const t = computeLineTotals(line({ produced: 10, endBal: 10 }), 300)
    expect(t.sold).toBe(0)
    expect(isImpossibleLine(t)).toBe(false)
  })
})

describe('looksLikeMissingInbound', () => {
  it('recognises an impossible line at a branch that neither baked nor received', () => {
    // Stock appeared from somewhere: almost always the sending branch's report
    // has not been encoded yet.
    const q = line({ endBal: 25 })
    expect(looksLikeMissingInbound(q, computeLineTotals(q, 300))).toBe(true)
  })

  it('does not blame a missing transfer when the branch produced its own stock', () => {
    // Produced something and still went negative — that is a miscount here, and
    // the fix is different.
    const q = line({ produced: 5, endBal: 25 })
    expect(looksLikeMissingInbound(q, computeLineTotals(q, 300))).toBe(false)
  })

  it('does not blame a missing transfer when stock was already received', () => {
    const q = line({ transferredIn: 5, endBal: 25 })
    expect(looksLikeMissingInbound(q, computeLineTotals(q, 300))).toBe(false)
  })

  it('says nothing about a line that is not impossible', () => {
    const q = line({ endBal: 0 })
    expect(looksLikeMissingInbound(q, computeLineTotals(q, 300))).toBe(false)
  })
})
