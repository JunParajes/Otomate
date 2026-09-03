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

/**
 * Turns Prisma's unique-constraint error into a readable 409.
 *
 * Takes one rule per unique column, because a table can have more than one and
 * the caller cannot know which was hit. The `field` argument used to be accepted
 * and discarded, which was harmless while every table had a single unique
 * column — and wrong the moment Branch gained a second: a duplicate short name
 * reported "a branch with that name already exists".
 *
 * When Prisma does not say which constraint was violated, the FIRST rule's
 * message is used. A slightly wrong 409 beats a 500 for something the caller
 * plainly did.
 */
export function rethrowUniqueViolation(
  error: unknown,
  ...rules: [field: string, message: string][]
): never {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    throw error
  }
  // Postgres reports either the column list or the index name, depending on the
  // constraint — "abbreviation" or "Branch_abbreviation_key".
  const target = error.meta?.target
  const named = Array.isArray(target) ? target.join(' ') : typeof target === 'string' ? target : ''

  const matched = rules.find(([field]) => named.includes(field))
  const [, message] = matched ?? rules[0]!
  throw new HttpError(409, message, 'DUPLICATE')
}
