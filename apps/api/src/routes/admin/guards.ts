import { Prisma } from '@prisma/client'
import type { AuthContext, PermissionName } from '@otomate/shared'
import { SUPER_ADMIN_ROLE } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { HttpError } from '../../middleware/error-handler'

/**
 * Guards that stop an admin panel from being used to break itself:
 * locking yourself out, deleting the last owner, or escalating privileges.
 */

/** You may never act destructively on your own account. */
export function assertNotSelf(auth: AuthContext, targetUserId: string, action: string): void {
  if (auth.userId === targetUserId) {
    throw new HttpError(400, `You cannot ${action} your own account`, 'SELF_ACTION_FORBIDDEN')
  }
}

/**
 * Privilege escalation guard: you cannot grant a role any permission you do not
 * hold yourself. Without this, anyone with roles:write could mint themselves
 * super-user powers by editing their own role's permission list.
 */
export function assertCanGrant(auth: AuthContext, permissions: readonly string[]): void {
  if (auth.isSuperAdmin) return
  const held = new Set<string>(auth.permissions)
  const excess = permissions.filter(p => !held.has(p))
  if (excess.length > 0) {
    throw new HttpError(
      403,
      `You cannot grant permissions you do not hold: ${excess.join(', ')}`,
      'ESCALATION_FORBIDDEN'
    )
  }
}

/** Only a Super Admin may hand out the Super Admin role. */
export async function assertCanAssignRole(auth: AuthContext, roleId: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id: roleId } })
  if (!role) {
    throw new HttpError(400, 'Selected role does not exist', 'VALIDATION_ERROR')
  }
  if (role.name === SUPER_ADMIN_ROLE && !auth.isSuperAdmin) {
    throw new HttpError(403, 'Only a Super Admin can assign the Super Admin role', 'FORBIDDEN')
  }
}

/** System roles are structural — the GUI may not rename, re-scope, or delete them. */
export function assertNotSystemRole(role: { isSystem: boolean; name: string }, action: string): void {
  if (role.isSystem) {
    throw new HttpError(400, `'${role.name}' is a system role and cannot be ${action}`, 'SYSTEM_ROLE_PROTECTED')
  }
}

/**
 * Refuses to strand the installation with no usable owner. Checked before
 * demoting or deactivating anyone who currently holds Super Admin.
 */
export async function assertNotLastSuperAdmin(userId: string, action: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } })
  if (!user || user.role.name !== SUPER_ADMIN_ROLE) return

  const remaining = await prisma.user.count({
    where: { isActive: true, role: { name: SUPER_ADMIN_ROLE }, id: { not: userId } },
  })
  if (remaining === 0) {
    throw new HttpError(
      400,
      `Cannot ${action} the last active Super Admin — promote someone else first`,
      'LAST_SUPER_ADMIN'
    )
  }
}

/** Turns Prisma's unique-constraint error into a readable 409. */
export function rethrowUniqueViolation(error: unknown, field: string, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new HttpError(409, message, 'DUPLICATE')
  }
  void field
  throw error
}
