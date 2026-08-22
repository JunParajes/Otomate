import { Router } from 'express'
import { createEmployeeSchema, updateEmployeeSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toEmployeeDto } from '../../lib/serializers'
import { rethrowUniqueViolation } from './guards'

const router = Router()
const withRelations = { branch: true, user: true } as const

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
      `That login is already linked to ${user.employee.name}`,
      'USER_ALREADY_LINKED'
    )
  }
}

router.get(
  '/',
  requirePermission('employees:read'),
  asyncHandler(async (_req, res) => {
    const employees = await prisma.employee.findMany({
      include: withRelations,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })
    res.json({ data: employees.map(toEmployeeDto), error: null })
  })
)

router.post(
  '/',
  requirePermission('employees:write'),
  asyncHandler(async (req, res) => {
    const parsed = createEmployeeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const { name, position, isActive } = parsed.data
    const employeeCode = cleanOptional(parsed.data.employeeCode) ?? null
    const userId = cleanOptional(parsed.data.userId) ?? null

    await assertBranchExists(parsed.data.branchId)
    await assertLinkable(userId)

    try {
      const employee = await prisma.employee.create({
        data: { name, position, isActive, employeeCode, userId, branchId: parsed.data.branchId ?? null },
        include: withRelations,
      })
      res.status(201).json({ data: toEmployeeDto(employee), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'employeeCode', 'An employee with that code already exists')
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
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.position !== undefined && { position: parsed.data.position }),
          ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
          ...(parsed.data.branchId !== undefined && { branchId: parsed.data.branchId }),
          ...(employeeCode !== undefined && { employeeCode }),
          ...(userId !== undefined && { userId }),
        },
        include: withRelations,
      })
      res.json({ data: toEmployeeDto(employee), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'employeeCode', 'An employee with that code already exists')
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
    res.json({ data: toEmployeeDto(employee), error: null })
  })
)

export default router
