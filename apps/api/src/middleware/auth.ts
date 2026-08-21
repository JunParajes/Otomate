import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AuthContext, PermissionName } from '@otomate/shared'
import { SUPER_ADMIN_ROLE } from '@otomate/shared'
import { verifyToken } from '../lib/jwt'
import { prisma } from '../prisma/client'
import { asyncHandler } from './async-handler'
import { HttpError } from './error-handler'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

/**
 * Verifies the token for IDENTITY only, then loads role, permissions and
 * isActive from the database on every request.
 *
 * The token deliberately carries no authority. A role change, a permission
 * edit, or a deactivation therefore takes effect on the user's very next
 * request instead of waiting up to 7 days for the token to expire.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid token', 'UNAUTHENTICATED')
  }

  let userId: string
  try {
    userId = verifyToken(header.slice(7)).userId
  } catch {
    throw new HttpError(401, 'Token expired or invalid', 'UNAUTHENTICATED')
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: true } } },
  })

  if (!user || !user.isActive) {
    // Covers deleted and deactivated accounts alike — no stale access.
    throw new HttpError(401, 'Account is inactive or no longer exists', 'UNAUTHENTICATED')
  }

  req.auth = {
    userId: user.id,
    roleId: user.roleId,
    roleName: user.role.name,
    isSuperAdmin: user.role.name === SUPER_ADMIN_ROLE,
    permissions: user.role.permissions.map(p => p.name as PermissionName),
    branchId: user.branchId,
    mustChangePassword: user.mustChangePassword,
  }

  next()
})

/**
 * Super Admin bypasses individual checks by design: adding a new permission to
 * the catalog must never lock the owner out of their own admin panel.
 */
export function requirePermission(permission: PermissionName) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth
    if (!auth) {
      throw new HttpError(401, 'Not authenticated', 'UNAUTHENTICATED')
    }
    if (auth.isSuperAdmin || auth.permissions.includes(permission)) {
      next()
      return
    }
    throw new HttpError(403, 'Insufficient permissions', 'FORBIDDEN')
  }
}

/** Guards the admin area as a whole. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth?.isSuperAdmin) {
    throw new HttpError(403, 'Super Admin only', 'FORBIDDEN')
  }
  next()
}
