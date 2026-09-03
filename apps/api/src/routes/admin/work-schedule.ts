import { Router } from 'express'
import {
  createWorkScheduleSchema,
  cutoffDays,
  cutoffEnd,
  isUnderOneMonth,
  isWorkingStatus,
  partnerRoleFor,
  updateEntriesSchema,
  updateWorkScheduleSchema,
  formatEmployeeName,
  formatEmployeeNameFiled,
  type WorkSchedule,
  type WorkScheduleRow,
} from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission, can } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { rethrowUniqueViolation } from './guards'
import { buildWorkScheduleWorkbook, workbookFilename } from '../../lib/work-schedule-workbook'

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
  assignedBranch: { select: { id: true, name: true, abbreviation: true } },
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
      branchPlans: { include: { plannedBy: { select: { id: true, name: true } } } },
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

  /*
   * Who is covering for whom, keyed by coverer and day.
   *
   * Built from the off days themselves rather than stored against the coverer,
   * so it cannot drift out of step with the entry it describes.
   */
  const covering = new Map<string, {
    employeeId: string
    employeeName: string
    branchName: string | null
    conflict: boolean
  }>()

  /** Everyone's planned status per day, so a cover can be checked against it. */
  const statusOf = new Map<string, string>()
  for (const e of schedule.entries) statusOf.set(`${e.employeeId}|${day(e.day)}`, e.status)
  /*
   * A cover who is themselves off or not rostered is not a cover. Missing
   * entries are NOT counted: someone hired mid-cutoff simply has no plan yet,
   * and flagging them would be noise rather than a finding.
   */
  const notWorking = (employeeId: string, d: string) => {
    const status = statusOf.get(`${employeeId}|${d}`)
    return status === 'OFF' || status === 'NOT_SCHEDULED'
  }

  const byEmployee = new Map<string, typeof schedule.entries>()
  for (const e of schedule.entries) {
    const list = byEmployee.get(e.employeeId) ?? []
    list.push(e)
    byEmployee.set(e.employeeId, list)
  }

  const byId = new Map(employees.map(e => [e.id, e]))
  for (const e of schedule.entries) {
    if (e.status !== 'OFF' || !e.coveredById) continue
    const offPerson = byId.get(e.employeeId)
    if (!offPerson) continue
    covering.set(`${e.coveredById}|${day(e.day)}`, {
      employeeId: e.employeeId,
      employeeName: formatEmployeeName(offPerson),
      branchName: offPerson.branch?.name ?? null,
      conflict: notWorking(e.coveredById, day(e.day)),
    })
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
        remarks: e.remarks,
        coverConflict: Boolean(e.coveredById) && notWorking(e.coveredById!, day(e.day)),
      }
    }
    return {
      employeeId: emp.id,
      name: formatEmployeeName(emp),
      nameFiled: formatEmployeeNameFiled(emp),
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
      covering: days.reduce<WorkScheduleRow['covering']>((acc, d) => {
        const found = covering.get(`${emp.id}|${d}`)
        if (found) acc[d] = found
        return acc
      }, {}),
      days: byDay,
    }
  })

  /*
   * Which branches HR has finished. Not derivable from the entries: a branch
   * where everyone genuinely works all seven days looks exactly like one nobody
   * has opened, and telling those apart before approval is the point.
   */
  const plans = new Map(schedule.branchPlans.map(p => [p.branchId, p]))
  const branchOrder: WorkSchedule['branches'] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = row.branch?.id ?? '__none__'
    if (seen.has(key)) continue
    seen.add(key)
    const plan = row.branch ? plans.get(row.branch.id) : undefined
    branchOrder.push({
      branchId: row.branch?.id ?? null,
      branchName: row.branch?.name ?? 'Unassigned',
      staffCount: rows.filter(r => (r.branch?.id ?? '__none__') === key).length,
      planned: Boolean(plan),
      plannedBy: plan?.plannedBy ?? null,
      plannedAt: plan?.plannedAt.toISOString() ?? null,
    })
  }
  branchOrder.sort((a, b) => a.branchName.localeCompare(b.branchName))

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
    branches: branchOrder,
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
 * The workbook — one sheet per branch, or one sheet for the branch asked for.
 *
 * Generated here rather than in the browser: the rows are already assembled and
 * already permission-filtered, so the file cannot contain anything the caller
 * could not see, and the frontend carries no spreadsheet library.
 *
 * Reading, not editing — so an approved schedule exports exactly like a draft.
 */
router.get(
  '/:id/export',
  requirePermission('schedule:read'),
  asyncHandler(async (req, res) => {
    const schedule = await loadSchedule(pathParam(req, 'id'), can(req, 'hr:read'))
    if (!schedule) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')

    const wanted = typeof req.query.branch === 'string' ? req.query.branch : 'ALL'

    // Grouped in the grid's own order, so the file reads like the screen.
    const byBranch = new Map<string, typeof schedule.rows>()
    for (const row of schedule.rows ?? []) {
      const key = row.branch?.name ?? 'Unassigned'
      byBranch.set(key, [...(byBranch.get(key) ?? []), row])
    }
    let groups = [...byBranch.entries()].sort(([a], [b]) => a.localeCompare(b))

    let branchName: string | null = null
    if (wanted !== 'ALL') {
      const branch = (schedule.branches ?? []).find(b => b.branchId === wanted)
      if (!branch) throw new HttpError(404, 'That branch is not in this schedule', 'NOT_FOUND')
      branchName = branch.branchName
      groups = groups.filter(([name]) => name === branch.branchName)
    }

    const workbook = buildWorkScheduleWorkbook(
      schedule,
      groups as [string, NonNullable<typeof schedule.rows>][],
      new Date()
    )
    const filename = workbookFilename(schedule, branchName)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    await workbook.xlsx.write(res)
    res.end()
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
      rethrowUniqueViolation(error, ['weekStart', 'That cutoff already has a schedule'])
      throw error
    }
  })
)

/**
 * An approved plan is closed to everyone, the approver included.
 *
 * The approver used to be allowed to edit in place, which was wrong: the record
 * carries "approved by X at T", and content changed after that stamp makes the
 * stamp a lie — it claims approval of a plan that no longer exists. That is the
 * exact quiet falsification this feature was built to stop.
 *
 * Reopening is the way through. It clears the approval, so the plan is honestly
 * a draft again, and approving it afterwards stamps what was actually approved.
 */
function assertEditable(status: string, _req: Parameters<typeof can>[0]): void {
  if (status === 'APPROVED') {
    throw new HttpError(
      409,
      'This schedule is approved. Reopen it before changing the plan — approving again will re-stamp it.',
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

    /*
     * "Working at another branch" means ANOTHER branch. Naming someone's own
     * branch is a no-op that reads as a transfer in the grid, so it is
     * normalised away here rather than only hidden in the picker — the API is
     * where the rule has to hold.
     */
    const staff = await prisma.employee.findMany({
      where: { id: { in: parsed.data.entries.map(e => e.employeeId) } },
      select: { id: true, branchId: true },
    })
    const homeBranch = new Map(staff.map(e => [e.id, e.branchId]))

    // One transaction: a half-saved row would leave the grid showing something
    // nobody chose.
    await prisma.$transaction(
      parsed.data.entries.map(e => {
        const assigned = e.assignedBranchId && e.assignedBranchId !== homeBranch.get(e.employeeId)
          ? e.assignedBranchId
          : null
        /*
         * What a day can carry follows from whether it is worked at all.
         *
         * Someone off, or not rostered, cannot also be sent to another branch or
         * paired with a colleague — and only a day OFF can name a cover, since a
         * day never rostered has no shift for anyone to cover. Enforced here as
         * well as hidden in the form: the form is where it is noticed, the API is
         * where the rule has to hold.
         */
        const working = isWorkingStatus(e.status)
        const partnerRole = partnerRoleFor(e.status)
        const data = {
          status: e.status,
          assignedBranchId: working ? assigned : null,
          coveredById: partnerRole === 'COVER' ? e.coveredById ?? null : null,
          pairedWithId: partnerRole === 'WITH' ? e.pairedWithId ?? null : null,
          remarks: e.remarks?.trim() || null,
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

/**
 * Marks a branch planned, or takes the mark off again.
 *
 * HR works branch by branch, and before this there was no way to tell a branch
 * that was finished from one nobody had opened — Submit sent the lot either way.
 */
router.put(
  '/:id/branches/:branchId/planned',
  requirePermission('schedule:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.workSchedule.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')
    assertEditable(existing.status, req)

    const branchId = pathParam(req, 'branchId')
    const planned = req.body?.planned !== false

    if (planned) {
      await prisma.workScheduleBranchPlan.upsert({
        where: { scheduleId_branchId: { scheduleId: existing.id, branchId } },
        update: { plannedAt: new Date(), plannedById: req.auth?.userId ?? null },
        create: { scheduleId: existing.id, branchId, plannedById: req.auth?.userId ?? null },
      })
    } else {
      await prisma.workScheduleBranchPlan.deleteMany({
        where: { scheduleId: existing.id, branchId },
      })
    }
    res.json({ data: await loadSchedule(existing.id, can(req, 'hr:read')), error: null })
  })
)

router.delete(
  '/:id',
  requirePermission('schedule:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.workSchedule.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Schedule not found', 'NOT_FOUND')
    // Same rule as editing: reopen first. Deleting an approved plan outright
    // would take the record and its approval with it in one unremarkable click.
    if (existing.status === 'APPROVED') {
      throw new HttpError(
        409,
        'This schedule is approved. Reopen it before deleting it.',
        'SCHEDULE_APPROVED'
      )
    }
    // Entries cascade.
    await prisma.workSchedule.delete({ where: { id: existing.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router
