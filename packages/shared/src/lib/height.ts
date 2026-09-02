/**
 * Height is STORED in whole centimetres and ENTERED in feet and inches.
 *
 * Nobody here says "170 centimetres" — they say 5'7". But centimetres are what
 * the record should hold: one integer instead of two, no ambiguity about whether
 * a stray inches value belongs to the feet beside it, and it sorts and compares
 * without arithmetic. So the conversion lives at the edge, exactly like pesos
 * and centavos.
 *
 * The round trip is lossless for whole-inch entry. Every height from 4'0" to
 * 7'11" survives feet+inches → round to centimetres → back to feet+inches
 * unchanged; the test asserts all 48 of them, because a height that reads back
 * an inch shorter than it was typed would be a quiet, permanent corruption of
 * the record.
 */

const CM_PER_INCH = 2.54
const INCHES_PER_FOOT = 12

/** Feet and inches to whole centimetres. Inches may exceed 11 and carry over. */
export function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH)
}

/**
 * Whole centimetres to feet and inches, rounded to the nearest inch.
 *
 * 11.5 inches rounds up to 12, which is a foot — returned as the next foot and
 * zero inches rather than the nonsense 5'12".
 */
export function cmToFeetInches(cm: number | null | undefined): { feet: number; inches: number } | null {
  if (cm == null || !Number.isFinite(cm) || cm <= 0) return null
  const totalInches = Math.round(cm / CM_PER_INCH)
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  }
}

/** `5'7"`, or an em dash when the height is not recorded. */
export function formatHeight(cm: number | null | undefined): string {
  const ft = cmToFeetInches(cm)
  return ft ? `${ft.feet}'${ft.inches}"` : '—'
}
