import { Router } from 'express'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { toPermissionDto } from '../../lib/serializers'

const router = Router()

/**
 * Read-only by design. The catalog lives in packages/shared and is synced by
 * the seed; there is deliberately no create/update/delete here.
 */
router.get(
  '/',
  requirePermission('roles:read'),
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    res.json({ data: permissions.map(toPermissionDto), error: null })
  })
)

export default router
