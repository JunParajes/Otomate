import { Router } from 'express'
import { createRoleSchema, updateRoleSchema, deleteRoleSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toRoleDto } from '../../lib/serializers'
import { assertCanGrant, assertNotSystemRole, rethrowUniqueViolation } from './guards'

const router = Router()


/** Maps permission names to their catalog rows, rejecting anything unknown. */
async function resolvePermissionIds(names: readonly string[]): Promise<{ id: string }[]> {
  if (names.length === 0) return []
  const rows = await prisma.permission.findMany({ where: { name: { in: [...names] } } })
  if (rows.length !== names.length) {
    const found = new Set(rows.map(r => r.name))
    const missing = names.filter(n => !found.has(n))
    throw new HttpError(400, `Unknown permission(s): ${missing.join(', ')}`, 'VALIDATION_ERROR')
  }
  return rows.map(r => ({ id: r.id }))
}

router.get(
  '/',
  requirePermission('roles:read'),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    })
    res.json({
      data: roles.map(r => ({ ...toRoleDto(r), userCount: r._count.users })),
      error: null,
    })
  })
)

router.post(
  '/',
  requirePermission('roles:write'),
  asyncHandler(async (req, res) => {
    const parsed = createRoleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    assertCanGrant(req.auth!, parsed.data.permissions)
    const permissionIds = await resolvePermissionIds(parsed.data.permissions)

    try {
      const role = await prisma.role.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          permissions: { connect: permissionIds },
        },
        include: { permissions: true },
      })
      res.status(201).json({ data: { ...toRoleDto(role), userCount: 0 }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['name', 'A role with that name already exists'])
    }
  })
)

router.patch(
  '/:id',
  requirePermission('roles:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateRoleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.role.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Role not found', 'NOT_FOUND')
    assertNotSystemRole(existing, 'modified')

    if (parsed.data.permissions) assertCanGrant(req.auth!, parsed.data.permissions)
    const permissionIds = parsed.data.permissions
      ? await resolvePermissionIds(parsed.data.permissions)
      : undefined

    try {
      const role = await prisma.role.update({
        where: { id: existing.id },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.description !== undefined && { description: parsed.data.description }),
          // `set` replaces the whole list, so unticking a box actually revokes.
          ...(permissionIds && { permissions: { set: permissionIds } }),
        },
        include: { permissions: true, _count: { select: { users: true } } },
      })
      res.json({ data: { ...toRoleDto(role), userCount: role._count.users }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['name', 'A role with that name already exists'])
    }
  })
)

router.delete(
  '/:id',
  requirePermission('roles:write'),
  asyncHandler(async (req, res) => {
    const parsed = deleteRoleSchema.safeParse(req.body ?? {})
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.role.findUnique({
      where: { id: pathParam(req, 'id') },
      include: { _count: { select: { users: true } } },
    })
    if (!existing) throw new HttpError(404, 'Role not found', 'NOT_FOUND')
    assertNotSystemRole(existing, 'deleted')

    const userCount = existing._count.users

    // User.roleId is ON DELETE RESTRICT, so a bare delete would surface a raw
    // FK error. Require an explicit destination for any users still attached.
    if (userCount > 0) {
      const target = parsed.data.reassignToRoleId
      if (!target) {
        throw new HttpError(
          409,
          `${userCount} user(s) still have this role. Choose a role to reassign them to first.`,
          'ROLE_IN_USE'
        )
      }
      if (target === existing.id) {
        throw new HttpError(400, 'Cannot reassign users to the role being deleted', 'VALIDATION_ERROR')
      }
      const destination = await prisma.role.findUnique({ where: { id: target } })
      if (!destination) throw new HttpError(400, 'Destination role does not exist', 'VALIDATION_ERROR')

      // Reassign and delete atomically — a partial run would strand users.
      await prisma.$transaction([
        prisma.user.updateMany({ where: { roleId: existing.id }, data: { roleId: target } }),
        prisma.role.delete({ where: { id: existing.id } }),
      ])
      res.json({ data: { success: true, reassigned: userCount }, error: null })
      return
    }

    await prisma.role.delete({ where: { id: existing.id } })
    res.json({ data: { success: true, reassigned: 0 }, error: null })
  })
)

export default router
