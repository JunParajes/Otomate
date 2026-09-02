import { z } from 'zod'

/**
 * The work schedule — the PLAN for one cutoff.
 *
 * Deliberately separate from what actually happened. Before this, both lived in
 * one spreadsheet: HR drafted the week, then edited the same cells as absences
 * and off-requests came in, so by Wednesday nobody could see what had been
 * planned — only what was left. The plan is a record in its own right, and the
 * actuals will point back at it rather than overwrite it.
 */

/** The five the branches use. Nothing here describes an outcome. */
export const WORK_DAY_STATUSES = [
  'SCHEDULED',
  'NOT_SCHEDULED',
  'OFF',
  'FRONTLINE',
  'OPENER',
] as const
export type WorkDayStatus = (typeof WORK_DAY_STATUSES)[number]

/** What HR writes in the cell, and what it means on the floor. */
export const WORK_DAY_LABELS: Record<WorkDayStatus, string> = {
  SCHEDULED: 'Scheduled',
  NOT_SCHEDULED: 'No schedule',
  OFF: 'Day off',
  FRONTLINE: 'Frontline',
  OPENER: 'Opener',
}

/** The mark in the grid — kept short, because the grid is scanned, not read. */
export const WORK_DAY_MARKS: Record<WorkDayStatus, string> = {
  SCHEDULED: '✓',
  NOT_SCHEDULED: '✗',
  OFF: 'Off',
  FRONTLINE: 'FL',
  OPENER: 'Op',
}

export const WORK_DAY_HINTS: Record<WorkDayStatus, string> = {
  SCHEDULED: 'Working. The Team Leader decides opener or closer.',
  NOT_SCHEDULED: 'Not rostered that day — not a day off.',
  OFF: 'Their day off.',
  FRONTLINE: 'Commissary staff sent to the bakery counter.',
  OPENER: 'Named as opener by the manager, rather than the Team Leader deciding.',
}

export const WORK_SCHEDULE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED'] as const
export type WorkScheduleStatus = (typeof WORK_SCHEDULE_STATUSES)[number]

export const WORK_SCHEDULE_STATUS_LABELS: Record<WorkScheduleStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
}

/**
 * The cutoff runs THURSDAY to WEDNESDAY.
 *
 * Not a preference to be tidied away later: payroll, holiday pay and offsetting
 * are all reckoned against it, so a week that starts on Monday would silently
 * disagree with every figure the business already computes.
 */
export const CUTOFF_START_WEEKDAY = 4 // Thursday, as getUTCDay() counts
export const CUTOFF_LENGTH_DAYS = 7

/**
 * Date arithmetic here is on UTC parts, never local ones.
 *
 * A date-only string parsed by Date.parse is midnight UTC, which is the previous
 * evening in Davao (UTC+8). Using local getters would shift a cutoff a day for
 * half the year — and a schedule off by one day is worse than no schedule.
 */
function parseDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return null
  const d = new Date(`${iso.trim()}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Is this the Thursday a cutoff must start on? */
export function isCutoffStart(iso: string): boolean {
  const d = parseDay(iso)
  return d !== null && d.getUTCDay() === CUTOFF_START_WEEKDAY
}

/** The Thursday on or before the given day — the cutoff a date falls in. */
export function cutoffStartFor(iso: string): string | null {
  const d = parseDay(iso)
  if (!d) return null
  const back = (d.getUTCDay() - CUTOFF_START_WEEKDAY + 7) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return toIsoDay(d)
}

/** The seven days of a cutoff, Thursday first. */
export function cutoffDays(weekStart: string): string[] {
  const d = parseDay(weekStart)
  if (!d) return []
  return Array.from({ length: CUTOFF_LENGTH_DAYS }, (_, i) => {
    const day = new Date(d)
    day.setUTCDate(day.getUTCDate() + i)
    return toIsoDay(day)
  })
}

/** The Wednesday that closes the cutoff. */
export function cutoffEnd(weekStart: string): string | null {
  const days = cutoffDays(weekStart)
  return days.length ? days[days.length - 1]! : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "27 Aug – 2 Sep 2026", the way the spreadsheet titles itself.
 *
 * Built from an explicit month list rather than toLocaleDateString. Locale output
 * depends on the ICU data compiled into Node — the same call renders "Sept" here
 * and can render "Sep" on the CI runner — so a formatted date would be a string
 * that changes under the code without the code changing.
 */
export function formatCutoff(weekStart: string): string {
  const days = cutoffDays(weekStart)
  if (!days.length) return '—'
  const part = (iso: string, withYear: boolean) => {
    const [y, m, d] = iso.split('-').map(Number)
    return `${d} ${MONTHS[m! - 1]}${withYear ? ` ${y}` : ''}`
  }
  return `${part(days[0]!, false)} – ${part(days[days.length - 1]!, true)}`
}

/**
 * Whether someone had been employed a full month by a given day.
 *
 * Staff under a month are not eligible for holiday pay or offsetting, and the
 * manager needs to see that while planning rather than discover it at payroll.
 * Derived from the hire date — never a stored flag, which would be wrong the day
 * after it was written.
 */
export function isUnderOneMonth(dateHired: string | null | undefined, on: string): boolean {
  const hired = dateHired ? parseDay(dateHired) : null
  const day = parseDay(on)
  if (!hired || !day) return false
  const monthLater = new Date(hired)
  monthLater.setUTCMonth(monthLater.getUTCMonth() + 1)
  return day < monthLater
}

export const createWorkScheduleSchema = z.object({
  weekStart: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the Thursday the cutoff starts')
    .refine(isCutoffStart, 'A cutoff starts on a Thursday'),
  notes: z.string().trim().max(500, 'That note is too long').nullable().optional(),
})
export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>

/**
 * One cell. Sent as a batch: HR edits a row at a time, and a request per cell
 * would be 581 of them for a full cutoff.
 */
export const workScheduleEntrySchema = z.object({
  employeeId: z.string().min(1),
  day: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bad day'),
  status: z.enum(WORK_DAY_STATUSES),
  /** Working at another branch that day. */
  assignedBranchId: z.string().nullable().optional(),
  /** Off, with this colleague covering. */
  coveredById: z.string().nullable().optional(),
  /** Rostered alongside this colleague. */
  pairedWithId: z.string().nullable().optional(),
})
export type WorkScheduleEntryInput = z.infer<typeof workScheduleEntrySchema>

export const updateEntriesSchema = z.object({
  entries: z.array(workScheduleEntrySchema).min(1, 'Nothing to save').max(2000),
})
export type UpdateEntriesInput = z.infer<typeof updateEntriesSchema>

export const updateWorkScheduleSchema = z.object({
  status: z.enum(WORK_SCHEDULE_STATUSES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>

export interface WorkScheduleEntryRecord {
  id: string
  employeeId: string
  day: string
  status: WorkDayStatus
  assignedBranch: { id: string; name: string } | null
  coveredBy: { id: string; name: string } | null
  pairedWith: { id: string; name: string } | null
}

/**
 * The 201 details a manager needs while planning — where someone lives, how to
 * reach them, how long they have been here.
 *
 * OMITTED, not nulled, for a caller without `hr:read` — the same rule the
 * employee DTO follows, so an unauthorised response carries no trace of an
 * address rather than a shape implying one exists. Someone can hold
 * `schedule:read` without being entitled to staff records.
 */
export interface WorkScheduleRowDetails {
  dateHired: string | null
  address: string | null
  contacts: { number: string; label: string | null }[]
}

export interface WorkScheduleRow {
  employeeId: string
  name: string
  /** Their own branch — the grouping the grid reads by. */
  branch: { id: string; name: string } | null
  position: string
  /**
   * Derived: not eligible for holiday pay or offsetting yet.
   *
   * Stays outside the gated section on purpose. It is the fact the schedule is
   * planned against, and it is a yes/no — it discloses far less than the hire
   * date it comes from.
   */
  underOneMonth: boolean
  details?: WorkScheduleRowDetails
  /** Keyed by day, so a cell lookup is not a scan of seven entries. */
  days: Record<string, WorkScheduleEntryRecord>
}

export interface WorkSchedule {
  id: string
  weekStart: string
  weekEnd: string
  days: string[]
  status: WorkScheduleStatus
  notes: string | null
  createdBy: { id: string; name: string } | null
  approvedBy: { id: string; name: string } | null
  approvedAt: string | null
  rows?: WorkScheduleRow[]
  createdAt: string
}
