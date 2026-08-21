import { Router } from 'express'
import { createBranchSchema, updateBranchSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toBranchDto } from '../../lib/serializers'
import { rethrowUniqueViolation } from './guards'

const router = Router()


router.get(
  '/',
  requirePermission('branches:read'),
  asyncHandler(async (_req, res) => {
    const branches = await prisma.branch.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })
    res.json({
      data: branches.map(b => ({ ...toBranchDto(b), userCount: b._count.users })),
      error: null,
    })
  })
)

router.post(
  '/',
  requirePermission('branches:write'),
  asyncHandler(async (req, res) => {
    const parsed = createBranchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    try {
      const branch = await prisma.branch.create({ data: parsed.data })
      res.status(201).json({ data: { ...toBranchDto(branch), userCount: 0 }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A branch with that name already exists')
    }
  })
)

router.patch(
  '/:id',
  requirePermission('branches:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateBranchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.branch.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Branch not found', 'NOT_FOUND')

    try {
      const branch = await prisma.branch.update({
        where: { id: existing.id },
        data: parsed.data,
        include: { _count: { select: { users: true } } },
      })
      res.json({ data: { ...toBranchDto(branch), userCount: branch._count.users }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A branch with that name already exists')
    }
  })
)

/**
 * Branch.branchId is ON DELETE SET NULL, so deleting would silently unassign
 * every user. Refuse instead and let the caller move them deliberately.
 */
router.delete(
  '/:id',
  requirePermission('branches:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.branch.findUnique({
      where: { id: pathParam(req, 'id') },
      include: { _count: { select: { users: true } } },
    })
    if (!existing) throw new HttpError(404, 'Branch not found', 'NOT_FOUND')

    if (existing._count.users > 0) {
      throw new HttpError(
        409,
        `${existing._count.users} user(s) are assigned to this branch. Reassign them, or deactivate the branch instead.`,
        'BRANCH_IN_USE'
      )
    }

    await prisma.branch.delete({ where: { id: existing.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router
