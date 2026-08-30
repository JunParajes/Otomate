/**
 * Records that take effect on a date and hold until the next one supersedes
 * them — pay rates, rents. Anything whose history must survive a change.
 */
export interface EffectiveDated {
  /** YYYY-MM-DD. String comparison is correct for this format and needs no parsing. */
  effectiveFrom: string
}

/**
 * Which record applied on a given date: the latest one starting on or before it.
 *
 * Returns null when nothing had taken effect yet — a record created before any
 * figure was entered. That is a real state and must not be read as zero.
 *
 * Callers pass history in any order; this does not assume it is sorted, because
 * a caller that sorted it differently would silently get the wrong answer.
 */
export function effectiveOn<T extends EffectiveDated>(history: T[], onDate: string): T | null {
  const eligible = history.filter(r => r.effectiveFrom <= onDate)
  if (eligible.length === 0) return null
  return eligible.reduce((best, r) => (r.effectiveFrom > best.effectiveFrom ? r : best))
}

/** Today, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The record in force today.
 *
 * Deliberately ignores future-dated entries: a raise or rent increase can be
 * recorded the moment it is agreed, and starts applying on its own date rather
 * than when someone remembers to enter it.
 */
export function currentlyEffective<T extends EffectiveDated>(history: T[]): T | null {
  return effectiveOn(history, todayIso())
}

/**
 * How a deadline stands relative to today.
 *
 * Shared by probation dates and permit expiries because the question is the
 * same: is this still fine, close enough to act on, or already missed. Warning
 * windows differ (a permit renewal takes longer than a probation decision), so
 * the caller sets it.
 */
export function deadlineStatus(
  date: string | null,
  warnWithinDays: number,
  today: string = todayIso()
): { state: 'none' | 'due' | 'overdue'; daysLeft: number | null } {
  if (!date) return { state: 'none', daysLeft: null }
  const MS_PER_DAY = 86_400_000
  const daysLeft = Math.round((Date.parse(date) - Date.parse(today)) / MS_PER_DAY)
  if (daysLeft < 0) return { state: 'overdue', daysLeft }
  if (daysLeft <= warnWithinDays) return { state: 'due', daysLeft }
  return { state: 'none', daysLeft }
}
