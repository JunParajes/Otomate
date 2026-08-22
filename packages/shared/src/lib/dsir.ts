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
  /** Baked or bought in AT this branch. Not stock received from another branch. */
  produced: number
  /**
   * Received from another branch. Certain products are made centrally — one
   * branch bakes cakes for everyone, another makes cream bread — so this is a
   * routine daily flow, not an exception.
   *
   * DERIVED from the sending branch's transfer record, never typed here: one
   * transfer, entered once, so the two branches cannot disagree about it.
   */
  transferredIn: number
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
  const preTotal = q.begBal + q.produced + q.transferredIn - q.transferredOut + q.overEnd
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

/**
 * A negative line on a receiving branch usually means the SENDING branch's
 * report has not been encoded yet, so the inbound stock is not visible. Worth
 * distinguishing from a genuine miscount, because the fix is different.
 */
export function looksLikeMissingInbound(q: DsirLineQuantities, totals: DsirLineTotals): boolean {
  return totals.sold < 0 && q.transferredIn === 0 && q.produced === 0
}
