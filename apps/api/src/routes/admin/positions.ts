import { Router } from 'express'
import { createPositionSchema, updatePositionSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { rethrowUniqueViolation } from './guards'

/**
 * Employee positions — the job roles a branch actually has.
 *
 * Reading is gated on `employees:read` rather than a permission of its own:
 * anyone who can see staff needs to see what they do, and the position picker on
 * the employee form is useless without it. Changing the list is `positions:write`,
 * which is an administrative act rather than an everyday one.
 */
const router = Router()

const withCount = { _count: { select: { employees: true } } } as const

type PositionRow = {
  id: string
  name: string
  isActive: boolean
  sortOrder: number
  _count: { employees: number }
}

const toDto = (p: PositionRow) => ({
  id: p.id,
  name: p.name,
  isActive: p.isActive,
  sortOrder: p.sortOrder,
  employeeCount: p._count.employees,
})

router.get(
  '/',
  requirePermission('employees:read'),
  asyncHandler(async (_req, res) => {
    const positions = await prisma.employeePosition.findMany({
      include: withCount,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json({ data: positions.map(toDto), error: null })
  })
)

router.post(
  '/',
  requirePermission('positions:write'),
  asyncHandler(async (req, res) => {
    const parsed = createPositionSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    try {
      const position = await prisma.employeePosition.create({
        data: parsed.data,
        include: withCount,
      })
      res.status(201).json({ data: toDto(position), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A position with that name already exists')
      throw error
    }
  })
)

router.patch(
  '/:id',
  requirePermission('positions:write'),
  asyncHandler(async (req, res) => {
    const parsed = updatePositionSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.employeePosition.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Position not found', 'NOT_FOUND')

    try {
      const position = await prisma.employeePosition.update({
        where: { id: existing.id },
        data: parsed.data,
        include: withCount,
      })
      res.json({ data: toDto(position), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A position with that name already exists')
      throw error
    }
  })
)

/**
 * Employee.positionId is ON DELETE RESTRICT, so a bare delete would surface a
 * raw foreign-key error. Refuse with a count instead and point at deactivation —
 * the same treatment product categories get, and for the same reason: the answer
 * is almost never "delete it anyway", it is "stop offering it to new records".
 */
router.delete(
  '/:id',
  requirePermission('positions:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.employeePosition.findUnique({
      where: { id: pathParam(req, 'id') },
      include: withCount,
    })
    if (!existing) throw new HttpError(404, 'Position not found', 'NOT_FOUND')

    if (existing._count.employees > 0) {
      throw new HttpError(
        409,
        `${existing._count.employees} employee(s) still hold this position. Move them first, or deactivate it instead.`,
        'POSITION_IN_USE'
      )
    }

    await prisma.employeePosition.delete({ where: { id: existing.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router
