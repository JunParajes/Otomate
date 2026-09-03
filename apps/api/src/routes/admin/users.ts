import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createUserSchema, updateUserSchema, resetPasswordSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toUserDto } from '../../lib/serializers'
import {
  assertCanAssignRole,
  assertNotLastSuperAdmin,
  assertNotSelf,
  rethrowUniqueViolation,
} from './guards'

const router = Router()
const withRelations = { role: true, branch: true } as const


router.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      include: withRelations,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    })
    res.json({ data: users.map(toUserDto), error: null })
  })
)

router.get(
  '/:id',
  requirePermission('users:read'),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: pathParam(req, 'id') }, include: withRelations })
    if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND')
    res.json({ data: toUserDto(user), error: null })
  })
)

router.post(
  '/',
  requirePermission('users:write'),
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const { email, name, password, roleId, branchId, mustChangePassword } = parsed.data

    await assertCanAssignRole(req.auth!, roleId)

    try {
      const user = await prisma.user.create({
        data: {
          email,
          name,
          password: await bcrypt.hash(password, 12),
          roleId,
          branchId: branchId ?? null,
          mustChangePassword,
        },
        include: withRelations,
      })
      res.status(201).json({ data: toUserDto(user), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['email', 'A user with that email already exists'])
    }
  })
)

router.patch(
  '/:id',
  requirePermission('users:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const target = await prisma.user.findUnique({ where: { id: pathParam(req, 'id') }, include: { role: true } })
    if (!target) throw new HttpError(404, 'User not found', 'NOT_FOUND')

    const { roleId, isActive } = parsed.data

    // Changing your own role is how you accidentally demote yourself out of the
    // admin panel — blocked outright rather than half-guarded.
    if (roleId && roleId !== target.roleId) {
      assertNotSelf(req.auth!, target.id, 'change the role of')
      await assertCanAssignRole(req.auth!, roleId)
      await assertNotLastSuperAdmin(target.id, 'demote')
    }

    if (isActive === false) {
      assertNotSelf(req.auth!, target.id, 'deactivate')
      await assertNotLastSuperAdmin(target.id, 'deactivate')
    }

    try {
      const user = await prisma.user.update({
        where: { id: target.id },
        data: {
          ...(parsed.data.email !== undefined && { email: parsed.data.email }),
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(roleId !== undefined && { roleId }),
          ...(parsed.data.branchId !== undefined && { branchId: parsed.data.branchId }),
          ...(isActive !== undefined && { isActive }),
        },
        include: withRelations,
      })
      res.json({ data: toUserDto(user), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['email', 'A user with that email already exists'])
    }
  })
)

/** Deactivate. Users are never hard-deleted — the audit log will reference them. */
router.delete(
  '/:id',
  requirePermission('users:write'),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!target) throw new HttpError(404, 'User not found', 'NOT_FOUND')

    assertNotSelf(req.auth!, target.id, 'deactivate')
    await assertNotLastSuperAdmin(target.id, 'deactivate')

    const user = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: false },
      include: withRelations,
    })
    res.json({ data: toUserDto(user), error: null })
  })
)

router.post(
  '/:id/reset-password',
  requirePermission('users:write'),
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const target = await prisma.user.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!target) throw new HttpError(404, 'User not found', 'NOT_FOUND')

    await prisma.user.update({
      where: { id: target.id },
      data: {
        password: await bcrypt.hash(parsed.data.password, 12),
        mustChangePassword: parsed.data.mustChangePassword,
      },
    })
    res.json({ data: { success: true }, error: null })
  })
)

export default router
