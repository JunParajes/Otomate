import { Router } from 'express'
import {
  createWorkScheduleSchema,
  cutoffDays,
  cutoffEnd,
  isUnderOneMonth,
  updateEntriesSchema,
  updateWorkScheduleSchema,
  formatEmployeeName,
  type WorkSchedule,
  type WorkScheduleRow,
} from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission, can } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { rethrowUniqueViolation } from './guards'

/**
 * The work schedule — the PLAN for one Thursday-to-Wednesday cutoff.
 *
 * What this is NOT is a record of what happened. Those were the same spreadsheet
 * before, and editing the plan as absences came in meant that by Wednesday the
 * original plan no longer existed anywhere. Actuals will reference a schedule
 * rather than overwrite it.
 */
const router = Router()

const day = (d: Date) => d.toISOString().slice(0, 10)
const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const entryInclude = {
  assignedBranch: { select: { id: true, name: true } },
  coveredBy: { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true } },
  pairedWith: { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true } },
} as const

type NameParts = { id: string; firstName: string; middleName: string | null; lastName: string; suffix: string | null }
const named = (e: NameParts | null) => (e ? { id: e.id, name: formatEmployeeName(e) } : null)

/**
 * Rows are assembled from the EMPLOYEE list, not from the entries.
 *
 * Someone hired mid-cutoff, or added to a branch after the schedule was drafted,
 * has no entries yet — building from entries would silently leave them off the
 * grid, which is exactly the person most likely to be forgotten.
 */
async function loadSchedule(id: string, canSeeHr: boolean): Promise<WorkSchedule | null> {
  const schedule = await prisma.workSchedule.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      entries: { include: entryInclude },
    },
  })
  if (!schedule) return null

  const weekStart = day(schedule.weekStart)
  const days = cutoffDays(weekStart)

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    include: {
      branch: { select: { id: true, name: true } },
      position: true,
      contacts: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: [{ branch: { name: 'asc' } }, { lastName: 'asc' }, { firstName: 'asc' }],
  })

  const byEmployee = new Map<string, typeof schedule.entries>()
  for (const e of schedule.entries) {
    const list = byEmployee.get(e.employeeId) ?? []
    list.push(e)
    byEmployee.set(e.employeeId, list)
  }

  const rows: WorkScheduleRow[] = employees.map(emp => {
    const entries = byEmployee.get(emp.id) ?? []
    const byDay: WorkScheduleRow['days'] = {}
    for (const e of entries) {
      byDay[day(e.day)] = {
        id: e.id,
        employeeId: e.employeeId,
        day: day(e.day),
        status: e.status,
        assignedBranch: e.assignedBranch,
        coveredBy: named(e.coveredBy),
        pairedWith: named(e.pairedWith),
      }
    }
    return {
      employeeId: emp.id,
      name: formatEmployeeName(emp),
      branch: emp.branch,
      position: emp.position.name,
      // Against the FIRST day of the cutoff: eligibility is judged for the week
      // being planned, not for whenever the page happens to be opened.
      eligibility: !emp.dateHired
        ? ('NO_HIRE_DATE' as const)
        : isUnderOneMonth(day(emp.dateHired), days[0]!)
          ? ('UNDER_ONE_MONTH' as const)
          : ('ELIGIBLE' as const),
      // Section omitted entirely without hr:read — see WorkScheduleRowDetails.
      ...(canSeeHr && {
        details: {
          dateHired: emp.dateHired ? day(emp.dateHired) : null,
          address: emp.address,
          contacts: emp.contacts.map(c => ({ number: c.number, label: c.label })),
        },
      }),
      days: byDay,
    }
  })

  return {
    id: schedule.id,
    weekStart,
    weekEnd: cutoffEnd(weekStart) ?? weekStart,
    days,
    status: schedule.status,
    notes: schedule.notes,
    createdBy: schedule.createdBy,
    approvedBy: schedule.approvedBy,
    approvedAt: schedule.approvedAt?.toISOString() ?? null,
    rows,
    createdAt: schedule.createdAt.toISOString(),
  }
}

router.get(
  '/',
  requirePermission('schedule:read'),
  asyncHandler(async (_req, res) => {
    const schedules = await prisma.workSchedule.findMany({
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        _count: { select: { entries: true } },
      },
      orderBy: { weekStart: 'desc' },
    })
    res.json({
      data: schedules.map(s => {
        const weekStart = day(s.weekStart)
        return {
          id: s.id,
          weekStart,
          weekEnd: cutoffEnd(weekStart) ?? weekStart,
          days: cutoffDays(weekStart),
          status: s.status,
          notes: s.notes,
          createdBy: s.createdBy,
          approvedBy: s.approvedBy,
          approvedAt: s.approvedAt?.toISOString() ?? null,
          entryCount: s._count.entries,
          createdAt: s.createdAt.toISOString(),
        }
      }),
      error: null,
    })
  })
)

router.get(
  '/:id',
  requirePermission('schedule:read'),
  asyncHandler(async (req, res) => {
    const schedule = await loadSchedule(pathParam(req, 'id'), can(req, 'hr:read'))
    if (!schedule) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')
    res.json({ data: schedule, error: null })
  })
)

/**
 * Creates the cutoff and PRE-FILLS every active employee as scheduled on all
 * seven days.
 *
 * Most cells in the spreadsheet are a tick, so starting from blank would mean
 * HR filling in five hundred-odd cells to say "as usual". Starting from
 * scheduled means they mark only the exceptions, which is what drafting a week
 * actually is.
 */
router.post(
  '/',
  requirePermission('schedule:write'),
  asyncHandler(async (req, res) => {
    const parsed = createWorkScheduleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const { weekStart, notes } = parsed.data
    const days = cutoffDays(weekStart)
    const employees = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true } })

    try {
      const created = await prisma.workSchedule.create({
        data: {
          weekStart: asDate(weekStart),
          notes: notes?.trim() || null,
          createdById: req.auth?.userId ?? null,
          entries: {
            create: employees.flatMap(e =>
              days.map(d => ({ employeeId: e.id, day: asDate(d), status: 'SCHEDULED' as const }))
            ),
          },
        },
      })
      const schedule = await loadSchedule(created.id, can(req, 'hr:read'))
      res.status(201).json({ data: schedule, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'weekStart', 'That cutoff already has a schedule')
      throw error
    }
  })
)

/**
 * An approved plan is a record, so changing it is deliberately harder than
 * drafting one: it takes the approver's permission, not the drafter's.
 */
function assertEditable(status: string, req: Parameters<typeof can>[0]): void {
  if (status === 'APPROVED' && !can(req, 'schedule:approve')) {
    throw new HttpError(
      409,
      'This schedule is approved. Ask the approver to reopen it before changing the plan.',
      'SCHEDULE_APPROVED'
    )
  }
}

router.patch(
  '/:id/entries',
  requirePermission('schedule:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateEntriesSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.workSchedule.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')
    assertEditable(existing.status, req)

    const days = new Set(cutoffDays(day(existing.weekStart)))
    for (const e of parsed.data.entries) {
      if (!days.has(e.day)) {
        throw new HttpError(400, `${e.day} is not in this cutoff`, 'DAY_OUT_OF_RANGE')
      }
    }

    // One transaction: a half-saved row would leave the grid showing something
    // nobody chose.
    await prisma.$transaction(
      parsed.data.entries.map(e => {
        const data = {
          status: e.status,
          assignedBranchId: e.assignedBranchId ?? null,
          // Only meaningful on the matching kind of day; cleared otherwise so a
          // status change cannot leave a stale colleague attached.
          coveredById: e.status === 'OFF' ? e.coveredById ?? null : null,
          pairedWithId: e.status === 'OFF' ? null : e.pairedWithId ?? null,
        }
        return prisma.workScheduleEntry.upsert({
          where: {
            scheduleId_employeeId_day: {
              scheduleId: existing.id,
              employeeId: e.employeeId,
              day: asDate(e.day),
            },
          },
          update: data,
          create: { scheduleId: existing.id, employeeId: e.employeeId, day: asDate(e.day), ...data },
        })
      })
    )

    res.json({ data: await loadSchedule(existing.id, can(req, 'hr:read')), error: null })
  })
)

/**
 * Status transitions. Drafting and approving are different permissions on
 * purpose: HR prepares the week, the General Manager signs it off.
 */
router.patch(
  '/:id',
  requirePermission('schedule:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateWorkScheduleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.workSchedule.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')

    const next = parsed.data.status
    if (next && next !== existing.status) {
      const approving = next === 'APPROVED'
      const reopening = existing.status === 'APPROVED' && next !== 'APPROVED'
      if ((approving || reopening) && !can(req, 'schedule:approve')) {
        throw new HttpError(
          403,
          approving ? 'Only the approver can approve a schedule' : 'Only the approver can reopen an approved schedule',
          'FORBIDDEN'
        )
      }
      if (next === 'SUBMITTED' && existing.status === 'APPROVED') {
        throw new HttpError(409, 'Reopen the schedule as a draft first', 'BAD_TRANSITION')
      }
    }

    await prisma.workSchedule.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.notes !== undefined && { notes: parsed.data.notes?.trim() || null }),
        ...(next && { status: next }),
        // Stamped on approval, cleared when reopened — an approval that no
        // longer applies must not keep a name against it.
        ...(next === 'APPROVED' && { approvedById: req.auth?.userId ?? null, approvedAt: new Date() }),
        ...(next && next !== 'APPROVED' && { approvedById: null, approvedAt: null }),
      },
    })
    res.json({ data: await loadSchedule(existing.id, can(req, 'hr:read')), error: null })
  })
)

router.delete(
  '/:id',
  requirePermission('schedule:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.workSchedule.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')
    if (existing.status === 'APPROVED' && !can(req, 'schedule:approve')) {
      throw new HttpError(409, 'An approved schedule cannot be deleted', 'SCHEDULE_APPROVED')
    }
    // Entries cascade.
    await prisma.workSchedule.delete({ where: { id: existing.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router
