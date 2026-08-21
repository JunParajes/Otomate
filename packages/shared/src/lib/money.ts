/**
 * Money is stored as integer centavos everywhere — never a float.
 * 0.1 + 0.2 !== 0.3 in JS, and those errors compound once daily sales
 * totals are summed. ₱25.50 is 2550.
 */
export const CURRENCY = 'PHP'
export const CURRENCY_SYMBOL = '₱'

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  return `${sign}${CURRENCY_SYMBOL}${(abs / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Parses user input ("25", "25.5", "₱1,250.00") into centavos. Null if unparseable. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, '').trim()
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/** Margin as a percentage of selling price. Null when either side is unknown. */
export function marginPercent(priceCents: number, costCents: number | null): number | null {
  if (costCents === null || priceCents <= 0) return null
  return Math.round(((priceCents - costCents) / priceCents) * 1000) / 10
}
