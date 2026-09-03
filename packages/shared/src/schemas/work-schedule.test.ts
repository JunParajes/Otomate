import { describe, expect, it } from 'vitest'
import {
  cellMark,
  createWorkScheduleSchema,
  cutoffCode,
  cutoffNumber,
  formatCutoffLabel,
  hasNoDayOff,
  cutoffDays,
  cutoffEnd,
  cutoffStartFor,
  formatCutoff,
  isCutoffStart,
  isUnderOneMonth,
  type WorkDayStatus,
} from './work-schedule.js'

/**
 * The cutoff is Thursday to Wednesday.
 *
 * Every figure the business derives from a week is reckoned against it, so an
 * off-by-one here would not look like a bug — it would look like the schedule
 * being wrong, which is much harder to trace.
 *
 * The sample week comes from the spreadsheet this replaces: Thursday 27 August
 * to Wednesday 2 September 2026.
 */

describe('cutoff boundaries', () => {
  it('accepts a Thursday and rejects every other day', () => {
    expect(isCutoffStart('2026-08-27')).toBe(true) // Thursday
    expect(isCutoffStart('2026-08-26')).toBe(false) // Wednesday
    expect(isCutoffStart('2026-08-28')).toBe(false) // Friday
    expect(isCutoffStart('2026-08-31')).toBe(false) // Monday
  })

  it('runs seven days, Thursday through Wednesday', () => {
    const days = cutoffDays('2026-08-27')
    expect(days).toEqual([
      '2026-08-27', '2026-08-28', '2026-08-29',
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ])
    expect(cutoffEnd('2026-08-27')).toBe('2026-09-02')
  })

  it('finds the cutoff any given day belongs to', () => {
    // A Thursday is its own start.
    expect(cutoffStartFor('2026-08-27')).toBe('2026-08-27')
    // Everything up to the following Wednesday belongs to it.
    expect(cutoffStartFor('2026-08-31')).toBe('2026-08-27')
    expect(cutoffStartFor('2026-09-02')).toBe('2026-08-27')
    // The next Thursday starts the next one.
    expect(cutoffStartFor('2026-09-03')).toBe('2026-09-03')
  })

  it('crosses a month boundary without losing a day', () => {
    const days = cutoffDays('2026-08-27')
    expect(days).toHaveLength(7)
    expect(new Set(days).size).toBe(7)
  })

  /**
   * The reason the arithmetic uses UTC parts throughout: a date-only string is
   * midnight UTC, which is the previous evening in Davao. Local getters would
   * move the week by a day for part of the year.
   */
  it('is not shifted by the local timezone', () => {
    // 1 January 2026 is a Thursday. Parsed as a local date on this machine
    // (UTC+8) it would still be the 1st, but the day-of-week check is what
    // would drift — so assert both the weekday and the first day produced.
    expect(isCutoffStart('2026-01-01')).toBe(true)
    expect(cutoffDays('2026-01-01')[0]).toBe('2026-01-01')
    expect(cutoffEnd('2026-01-01')).toBe('2026-01-07')
    // A year boundary in the other direction.
    expect(cutoffStartFor('2026-01-02')).toBe('2026-01-01')
    expect(cutoffEnd('2025-12-25')).toBe('2025-12-31')
  })

  it('formats the way the spreadsheet titles itself', () => {
    expect(formatCutoff('2026-08-27')).toBe('27 Aug – 2 Sep 2026')
  })

  it('refuses to create a cutoff that does not start on a Thursday', () => {
    expect(createWorkScheduleSchema.safeParse({ weekStart: '2026-08-27' }).success).toBe(true)
    const bad = createWorkScheduleSchema.safeParse({ weekStart: '2026-08-31' })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.issues[0]!.message).toContain('Thursday')
  })
})

/**
 * Under a month means no holiday pay and no offsetting. The manager has to see
 * it while planning the week, not find out at payroll.
 */
describe('one month of service', () => {
  it('is true before the monthly anniversary and false on it', () => {
    expect(isUnderOneMonth('2026-08-15', '2026-09-14')).toBe(true)
    expect(isUnderOneMonth('2026-08-15', '2026-09-15')).toBe(false)
    expect(isUnderOneMonth('2026-08-15', '2026-09-16')).toBe(false)
  })

  it('handles a hire date with no matching day next month', () => {
    // 31 Jan + 1 month has no 31 Feb; JS rolls to 3 March, so 2 March is still under.
    expect(isUnderOneMonth('2026-01-31', '2026-03-02')).toBe(true)
    expect(isUnderOneMonth('2026-01-31', '2026-03-03')).toBe(false)
  })

  it('is false when the hire date is unknown, rather than wrongly flagging someone', () => {
    expect(isUnderOneMonth(null, '2026-09-02')).toBe(false)
    expect(isUnderOneMonth('', '2026-09-02')).toBe(false)
  })

  it('flags someone hired inside the sample cutoff', () => {
    // From the spreadsheet: hired 26 Aug 2026, planning the week of 27 Aug.
    expect(isUnderOneMonth('2026-08-26', '2026-08-27')).toBe(true)
  })
})

/**
 * The WS number.
 *
 * Derived from the Thursday rather than counted on creation, so the same week
 * always carries the same number however the schedules were made.
 */
describe('cutoff numbering', () => {
  it('starts at WS-1 on the first Thursday of the year', () => {
    // 1 January 2026 is itself a Thursday.
    expect(cutoffNumber('2026-01-01')).toBe(1)
    expect(cutoffNumber('2026-01-08')).toBe(2)
  })

  it('numbers the sample week from the spreadsheet', () => {
    expect(cutoffNumber('2026-08-27')).toBe(35)
    expect(formatCutoffLabel('2026-08-27')).toBe('WS-35 · 27 Aug – 2 Sep 2026')
  })

  it('counts a New Year cutoff under the year it starts in', () => {
    // Thursday 31 December 2026 — five of its days are in January 2027.
    expect(cutoffNumber('2026-12-31')).toBe(53)
    // And the next one resets.
    expect(cutoffNumber('2027-01-07')).toBe(1)
  })

  it('handles a year whose first Thursday is not 1 January', () => {
    // 1 January 2025 is a Wednesday; the first Thursday is the 2nd.
    expect(cutoffNumber('2025-01-02')).toBe(1)
    expect(cutoffNumber('2025-01-09')).toBe(2)
  })

  it('refuses to number a day that is not a Thursday', () => {
    expect(cutoffNumber('2026-08-31')).toBeNull()
    expect(cutoffCode('2026-08-31')).toBe('WS-?')
  })
})

/**
 * "No day off this cutoff" — an indicator while planning, not a warning.
 */
describe('a cutoff with no day off', () => {
  const week = (...statuses: (WorkDayStatus | null)[]) => statuses

  it('flags someone working all seven days', () => {
    expect(hasNoDayOff(week(
      'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED'
    ))).toBe(true)
  })

  it('does not flag someone with a day off', () => {
    expect(hasNoDayOff(week(
      'SCHEDULED', 'SCHEDULED', 'OFF', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED'
    ))).toBe(false)
  })

  it('counts every working status, not just the plain tick', () => {
    // Six worked days across four statuses and no rest day is still no rest day.
    expect(hasNoDayOff(week(
      'OPENER', 'CLOSER', 'FRONTLINE', 'SCHEDULED', 'OPENER', 'CLOSER', 'NOT_SCHEDULED'
    ))).toBe(true)
  })

  /**
   * A no-schedule day is not rest. The two statuses exist precisely because
   * "not rostered" and "given the day off" are different things.
   */
  it('does not treat a no-schedule day as a day off', () => {
    expect(hasNoDayOff(week(
      'SCHEDULED', 'NOT_SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED'
    ))).toBe(true)
  })

  it('says nothing about someone who works no days at all', () => {
    // Every unplanned new hire would otherwise be flagged.
    expect(hasNoDayOff(week(
      'NOT_SCHEDULED', 'NOT_SCHEDULED', 'NOT_SCHEDULED', 'NOT_SCHEDULED',
      'NOT_SCHEDULED', 'NOT_SCHEDULED', 'NOT_SCHEDULED'
    ))).toBe(false)
    expect(hasNoDayOff(week(null, null, null, null, null, null, null))).toBe(false)
  })

  it('handles a part-planned week', () => {
    expect(hasNoDayOff(week('SCHEDULED', 'SCHEDULED', null, null, null, null, null))).toBe(true)
    expect(hasNoDayOff(week('SCHEDULED', 'OFF', null, null, null, null, null))).toBe(false)
  })
})

/**
 * One mark, three renderings. If this drifts, a printed sheet on a branch wall
 * disagrees with the screen and nobody finds out until the week is worked.
 */
describe('the mark in a cell', () => {
  const at = (name: string, abbreviation: string | null) => ({ id: 'b', name, abbreviation })

  it('shows the status mark for an ordinary day', () => {
    expect(cellMark({ status: 'SCHEDULED', assignedBranch: null })).toBe('✓')
    expect(cellMark({ status: 'NOT_SCHEDULED', assignedBranch: null })).toBe('✗')
    expect(cellMark({ status: 'OFF', assignedBranch: null })).toBe('Off')
    expect(cellMark({ status: 'FRONTLINE', assignedBranch: null })).toBe('FL')
    expect(cellMark({ status: 'OPENER', assignedBranch: null })).toBe('Op')
    expect(cellMark({ status: 'CLOSER', assignedBranch: null })).toBe('Cl')
  })

  it('shows the branch short name when someone is lent out', () => {
    expect(cellMark({ status: 'SCHEDULED', assignedBranch: at('TRD Puan', 'TRD') })).toBe('TRD')
    // Any working status, not just the plain tick.
    expect(cellMark({ status: 'OPENER', assignedBranch: at('KM 11', 'KM11') })).toBe('KM11')
  })

  it('falls back to the status when the branch has no short name', () => {
    expect(cellMark({ status: 'SCHEDULED', assignedBranch: at('Bangkerohan', null) })).toBe('✓')
  })

  it('never shows a branch against a day that is not worked', () => {
    // The API clears this, but the mark must not depend on that having happened.
    expect(cellMark({ status: 'OFF', assignedBranch: at('TRD Puan', 'TRD') })).toBe('Off')
  })

  it('is blank for a day nobody has planned', () => {
    expect(cellMark(null)).toBe('')
    expect(cellMark(undefined, '·')).toBe('·')
  })
})
