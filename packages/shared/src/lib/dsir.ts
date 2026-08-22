/**
 * The DSIR derivation, in one place.
 *
 * Sales are DERIVED from physical stock movement, never recorded — that is the
 * anti-theft control the whole document exists for (see docs/DOMAIN.md). This
 * formula is shared so the encoder's screen and the server can never disagree
 * about what a day's sales were.
 */

export interface DsirLineQuantities {
  begBal: number
  produced: number
  /** Sum of transfers of this product to other branches. */
  transferredOut: number
  overEnd: number
  /** Sum of charge records for this product — possibly several employees. */
  charged: number
  pulledOut: number
  endBal: number
}

export interface DsirLineTotals {
  /** Everything that was available to sell today. */
  preTotal: number
  /** Units that must therefore have been sold. */
  sold: number
  salesCents: number
}

export function computeLineTotals(q: DsirLineQuantities, unitPriceCents: number): DsirLineTotals {
  const preTotal = q.begBal + q.produced - q.transferredOut + q.overEnd
  const sold = preTotal - q.charged - q.pulledOut - q.endBal
  return { preTotal, sold, salesCents: sold * unitPriceCents }
}

export interface DsirReportTotals {
  salesCents: number
  collectionsCents: number
  /** Positive = overage, negative = shortage. Shortages hit staff wages. */
  varianceCents: number
  pulledOutCents: number
  chargedCents: number
  producedValueCents: number
}

/**
 * A negative `sold` is arithmetically possible but physically impossible — more
 * stock left than was ever available. It always means a miscount or a missing
 * entry, so the UI must surface it rather than quietly totalling it.
 */
export function isImpossibleLine(totals: DsirLineTotals): boolean {
  return totals.sold < 0
}
