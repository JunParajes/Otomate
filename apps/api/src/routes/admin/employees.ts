import { Router, type Request } from 'express'
import {
  createEmployeeSchema, updateEmployeeSchema, updateEmployeeHrSchema, createSalarySchema,
  separateEmployeeSchema, rehireEmployeeSchema,
  formatEmployeeName,
} from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { can, requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toEmployeeDto } from '../../lib/serializers'
import { rethrowUniqueViolation } from './guards'

const router = Router()
const withRelations = { branch: true, user: true, contacts: true, position: true, pastEmployment: true } as const
const withSalaries = {
  branch: true,
  user: true,
  contacts: true,
  position: true,
  pastEmployment: true,
  salaries: { include: { recordedBy: true } },
} as const

/** What this caller may see of a single employee record. */
function access(req: Request) {
  return { hr: can(req, 'hr:read'), salary: can(req, 'hr:salary:read') }
}

/**
 * The LIST never carries pay.
 *
 * The 201 fields are plain columns on Employee, so including them costs nothing
 * and lets the list show things like a probation warning. Salary is a join, and
 * shipping every employee's pay history to render a table of names is both
 * wasteful and more of it in flight than any one screen needs. The detail
 * endpoint below serves the one record actually being looked at.
 */
function listAccess(req: Request) {
  return { hr: can(req, 'hr:read'), salary: false }
}

/**
 * Salary rows are only fetched when they can be returned, so an unauthorised
 * request never pulls pay data out of the database at all.
 */
function includeFor(req: Request) {
  return can(req, 'hr:salary:read') ? withSalaries : withRelations
}

/** A stored date as YYYY-MM-DD, for comparing against what the form sent. */
function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** '' and undefined both mean "not set"; a date string passes through unchanged. */
function cleanDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  return trimmed ? new Date(`${trimmed}T00:00:00.000Z`) : null
}

/** Normalises the optional-unique fields: '' and undefined both mean "not set". */
function cleanOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function assertBranchExists(branchId: string | null | undefined): Promise<void> {
  if (!branchId) return
  const branch = await prisma.branch.findUnique({ where: { id: branchId } })
  if (!branch) throw new HttpError(400, 'Selected branch does not exist', 'VALIDATION_ERROR')
}

async function assertLinkable(userId: string | null | undefined, selfId?: string): Promise<void> {
  if (!userId) return
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { employee: true } })
  if (!user) throw new HttpError(400, 'That user account does not exist', 'VALIDATION_ERROR')
  if (user.employee && user.employee.id !== selfId) {
    throw new HttpError(
      409,
      `That login is already linked to ${formatEmployeeName(user.employee)}`,
      'USER_ALREADY_LINKED'
    )
  }
}

router.get(
  '/',
  requirePermission('employees:read'),
  asyncHandler(async (req, res) => {
    const employees = await prisma.employee.findMany({
      include: withRelations,
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    })
    res.json({ data: employees.map(e => toEmployeeDto(e, listAccess(req))), error: null })
  })
)

/** One record, with pay history — what the detail page loads. */
router.get(
  '/:id',
  requirePermission('employees:read'),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({
      where: { id: pathParam(req, 'id') },
      include: includeFor(req),
    })
    if (!employee) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')
    res.json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

router.post(
  '/',
  requirePermission('employees:write'),
  asyncHandler(async (req, res) => {
    const parsed = createEmployeeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const { firstName, lastName, positionId, isActive } = parsed.data
    const middleName = cleanOptional(parsed.data.middleName) ?? null
    const suffix = cleanOptional(parsed.data.suffix) ?? null
    const employeeCode = cleanOptional(parsed.data.employeeCode) ?? null
    const userId = cleanOptional(parsed.data.userId) ?? null

    await assertBranchExists(parsed.data.branchId)
    await assertLinkable(userId)

    try {
      const employee = await prisma.employee.create({
        data: {
          firstName, middleName, lastName, suffix,
          positionId, isActive, employeeCode, userId,
          branchId: parsed.data.branchId ?? null,
        },
        include: withRelations,
      })
      res.status(201).json({ data: toEmployeeDto(employee, access(req)), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['employeeCode', 'An employee with that code already exists'])
    }
  })
)

router.patch(
  '/:id',
  requirePermission('employees:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateEmployeeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.employee.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')

    const employeeCode = cleanOptional(parsed.data.employeeCode)
    const userId = cleanOptional(parsed.data.userId)
    await assertBranchExists(parsed.data.branchId)
    await assertLinkable(userId, existing.id)

    try {
      const employee = await prisma.employee.update({
        where: { id: existing.id },
        data: {
          ...(parsed.data.firstName !== undefined && { firstName: parsed.data.firstName }),
          ...(parsed.data.lastName !== undefined && { lastName: parsed.data.lastName }),
          ...(parsed.data.middleName !== undefined && { middleName: cleanOptional(parsed.data.middleName) ?? null }),
          ...(parsed.data.suffix !== undefined && { suffix: cleanOptional(parsed.data.suffix) ?? null }),
          ...(parsed.data.positionId !== undefined && { positionId: parsed.data.positionId }),
          ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
          ...(parsed.data.branchId !== undefined && { branchId: parsed.data.branchId }),
          ...(employeeCode !== undefined && { employeeCode }),
          ...(userId !== undefined && { userId }),
        },
        include: withRelations,
      })
      res.json({ data: toEmployeeDto(employee, access(req)), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['employeeCode', 'An employee with that code already exists'])
    }
  })
)

/**
 * Deactivate, never delete. Charges recorded against this person must stay
 * attributable after they leave — the same reasoning as users and products.
 */
router.delete(
  '/:id',
  requirePermission('employees:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.employee.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')

    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: { isActive: false },
      include: withRelations,
    })
    res.json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

/**
 * The 201 file — separate from PATCH /:id so pay and government IDs are not
 * reachable with `employees:write`, which every branch manager needs in order to
 * add staff.
 */
router.patch(
  '/:id/hr',
  requirePermission('hr:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateEmployeeHrSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.employee.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')

    const d = parsed.data
    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        ...(d.birthDate !== undefined && { birthDate: cleanDate(d.birthDate) }),
        ...(d.birthPlace !== undefined && { birthPlace: cleanOptional(d.birthPlace) ?? null }),
        ...(d.gender !== undefined && { gender: d.gender }),
        ...(d.civilStatus !== undefined && { civilStatus: d.civilStatus }),
        ...(d.religion !== undefined && { religion: cleanOptional(d.religion) ?? null }),
        // '' is how a cleared field arrives from the form; it means "not set",
        // not an empty address on file.
        ...(d.email !== undefined && { email: cleanOptional(d.email) ?? null }),
        ...(d.heightCm !== undefined && { heightCm: d.heightCm }),
        ...(d.weightGrams !== undefined && { weightGrams: d.weightGrams }),
        ...(d.educationLevel !== undefined && { educationLevel: d.educationLevel }),
        ...(d.educationDetail !== undefined && { educationDetail: cleanOptional(d.educationDetail) ?? null }),
        ...(d.remarks !== undefined && { remarks: cleanOptional(d.remarks) ?? null }),

        ...(d.confidentialityAgreement !== undefined && {
          confidentialityAgreement: d.confidentialityAgreement,
        }),
        ...(d.confidentialityAgreementOn !== undefined && {
          confidentialityAgreementOn: cleanDate(d.confidentialityAgreementOn),
        }),
        ...(d.authorityToDeduct !== undefined && { authorityToDeduct: d.authorityToDeduct }),
        ...(d.birthCertificate !== undefined && { birthCertificate: d.birthCertificate }),
        ...(d.marriageContract !== undefined && { marriageContract: d.marriageContract }),
        ...(d.authorityToDeductOn !== undefined && { authorityToDeductOn: cleanDate(d.authorityToDeductOn) }),
        ...(d.birthCertificateOn !== undefined && { birthCertificateOn: cleanDate(d.birthCertificateOn) }),
        ...(d.marriageContractOn !== undefined && { marriageContractOn: cleanDate(d.marriageContractOn) }),
        ...(d.address !== undefined && { address: cleanOptional(d.address) ?? null }),
        // Replacing the whole set is right for a form that shows every row at
        // once: a row deleted on screen has to disappear here too, and a diff
        // would need ids the form does not have for new rows.
        ...(d.contacts !== undefined && {
          contacts: {
            deleteMany: {},
            create: d.contacts.map((c, i) => ({
              number: c.number,
              label: cleanOptional(c.label) ?? null,
              sortOrder: i,
            })),
          },
        }),
        ...(d.emergencyName !== undefined && { emergencyName: cleanOptional(d.emergencyName) ?? null }),
        ...(d.emergencyRelation !== undefined && { emergencyRelation: cleanOptional(d.emergencyRelation) ?? null }),
        ...(d.emergencyContact !== undefined && { emergencyContact: cleanOptional(d.emergencyContact) ?? null }),

        ...(d.sssNumber !== undefined && { sssNumber: cleanOptional(d.sssNumber) ?? null }),
        ...(d.philhealthNumber !== undefined && { philhealthNumber: cleanOptional(d.philhealthNumber) ?? null }),
        ...(d.pagibigNumber !== undefined && { pagibigNumber: cleanOptional(d.pagibigNumber) ?? null }),
        ...(d.tin !== undefined && { tin: cleanOptional(d.tin) ?? null }),

        ...(d.dateHired !== undefined && { dateHired: cleanDate(d.dateHired) }),
        ...(d.employmentType !== undefined && { employmentType: d.employmentType }),
        ...(d.probationEndDate !== undefined && { probationEndDate: cleanDate(d.probationEndDate) }),
        ...(d.probationExtendedTo !== undefined && { probationExtendedTo: cleanDate(d.probationExtendedTo) }),
        ...(d.probationExtensionReason !== undefined && {
          probationExtensionReason: cleanOptional(d.probationExtensionReason) ?? null,
        }),
        ...(d.regularizedAt !== undefined && { regularizedAt: cleanDate(d.regularizedAt) }),
        ...(d.separatedAt !== undefined && { separatedAt: cleanDate(d.separatedAt) }),
        ...(d.separationReason !== undefined && { separationReason: cleanOptional(d.separationReason) ?? null }),

        ...(d.payoutMethod !== undefined && { payoutMethod: d.payoutMethod }),
        ...(d.payoutAccount !== undefined && { payoutAccount: cleanOptional(d.payoutAccount) ?? null }),
      },
      include: includeFor(req),
    })
    res.json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

/**
 * Records that somebody has left.
 *
 * One step rather than two fields: it closes the spell AND takes them off the
 * roster. Relying on whoever fills in a separation date to also remember to
 * deactivate the record is how someone stays on next week's schedule.
 */
router.post(
  '/:id/separate',
  requirePermission('hr:write'),
  asyncHandler(async (req, res) => {
    const parsed = separateEmployeeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.employee.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')
    if (existing.dateHired && parsed.data.separatedOn < dateOnlyString(existing.dateHired)) {
      throw new HttpError(400, 'They cannot leave before they were hired', 'VALIDATION_ERROR')
    }

    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        separatedAt: cleanDate(parsed.data.separatedOn),
        separationReason: cleanOptional(parsed.data.separationReason) ?? null,
        isActive: false,
      },
      include: includeFor(req),
    })
    res.json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

/**
 * Taking somebody back.
 *
 * A rehire STARTS FRESH: probation, holiday-pay eligibility and length of
 * service all run from the new hire date. So the current spell is FILED into
 * pastEmployment and the live fields are reset — not edited, because editing the
 * hire date would erase the fact they ever worked here before, silently, and
 * leave a returning employee looking like a stranger.
 *
 * Everything that is about the PERSON rather than the spell stays: government
 * IDs, contacts, address, documents, pay history.
 */
router.post(
  '/:id/rehire',
  requirePermission('hr:write'),
  asyncHandler(async (req, res) => {
    const parsed = rehireEmployeeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.employee.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')
    if (!existing.separatedAt) {
      throw new HttpError(
        409,
        'They have not been recorded as separated, so there is nothing to rehire them from.',
        'NOT_SEPARATED'
      )
    }
    if (!existing.dateHired) {
      /*
       * Refused rather than worked around. Without the original hire date there
       * is no spell to keep, and resetting would erase the separation too —
       * leaving somebody who demonstrably worked here with no trace of either
       * spell. Eligibility is reckoned from these dates, so the gap has to be
       * filled rather than stepped over.
       */
      throw new HttpError(
        409,
        'Add their original hire date first, so the previous spell can be kept on the record.',
        'NO_HIRE_DATE'
      )
    }
    if (parsed.data.dateHired < dateOnlyString(existing.separatedAt)) {
      throw new HttpError(400, 'They cannot be rehired before the day they left', 'VALIDATION_ERROR')
    }

    // Filing the old spell and resetting the new one must not half-happen: a
    // reset without the archive loses the history outright.
    const employee = await prisma.$transaction(async tx => {
      await tx.employmentPeriod.create({
        data: {
          employeeId: existing.id,
          hiredOn: existing.dateHired!,
          separatedOn: existing.separatedAt!,
          separationReason: existing.separationReason,
          employmentType: existing.employmentType,
          regularizedAt: existing.regularizedAt,
          recordedById: req.auth?.userId ?? null,
        },
      })
      return tx.employee.update({
        where: { id: existing.id },
        data: {
          dateHired: cleanDate(parsed.data.dateHired),
          employmentType: parsed.data.employmentType,
          probationEndDate: cleanDate(parsed.data.probationEndDate ?? null),
          // The clock restarts, so nothing from the old spell carries over.
          probationExtendedTo: null,
          probationExtensionReason: null,
          regularizedAt: null,
          separatedAt: null,
          separationReason: null,
          isActive: true,
        },
        include: includeFor(req),
      })
    })
    res.json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

/**
 * Records a pay rate from a date onward.
 *
 * An upsert on (employee, effectiveFrom): re-entering an existing start date is
 * a correction of that rate, not a second rate competing for the same day. The
 * unique constraint enforces the same thing at the database.
 *
 * Nothing here deletes or edits older rows — that is the point of the table.
 * Past payslips must keep the rate they were computed on.
 */
router.post(
  '/:id/salary',
  requirePermission('hr:salary:write'),
  asyncHandler(async (req, res) => {
    const parsed = createSalarySchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.employee.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Employee not found', 'NOT_FOUND')

    const { basicCents, allowanceCents, rateType, note } = parsed.data
    const effectiveFrom = new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`)
    const fields = {
      basicCents,
      allowanceCents,
      rateType,
      note: cleanOptional(note) ?? null,
      recordedById: req.auth?.userId ?? null,
    }

    await prisma.employeeSalary.upsert({
      where: { employeeId_effectiveFrom: { employeeId: existing.id, effectiveFrom } },
      create: { employeeId: existing.id, effectiveFrom, ...fields },
      update: fields,
    })

    // Read back with salaries so the caller gets the updated history in one trip.
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: existing.id },
      include: withSalaries,
    })
    res.status(201).json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

/**
 * Removes a pay rate.
 *
 * Deleting history is normally wrong, but a rate typed against the wrong date or
 * the wrong person has to be removable — it is a mistake, not a fact. Correcting
 * an amount is the upsert above; this is for a row that should never have
 * existed.
 */
router.delete(
  '/:id/salary/:salaryId',
  requirePermission('hr:salary:write'),
  asyncHandler(async (req, res) => {
    const salaryId = pathParam(req, 'salaryId')
    const record = await prisma.employeeSalary.findUnique({ where: { id: salaryId } })
    if (!record || record.employeeId !== pathParam(req, 'id')) {
      throw new HttpError(404, 'Salary record not found', 'NOT_FOUND')
    }
    await prisma.employeeSalary.delete({ where: { id: salaryId } })

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: record.employeeId },
      include: withSalaries,
    })
    res.json({ data: toEmployeeDto(employee, access(req)), error: null })
  })
)

export default router
