import { Router } from 'express'
import { prisma } from '../prisma/client'
import { authenticate, requirePermission } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { HttpError } from '../middleware/error-handler'
import { toUserDto } from '../lib/serializers'

const router = Router()

router.use(authenticate)

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      include: { role: true, branch: true },
    })

    if (!user) {
      throw new HttpError(404, 'User not found', 'NOT_FOUND')
    }

    res.json({
      data: {
        ...toUserDto(user),
        // Effective authority, straight from this request's DB read.
        permissions: req.auth!.permissions,
        isSuperAdmin: req.auth!.isSuperAdmin,
      },
      error: null,
    })
  })
)

router.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      include: { role: true, branch: true },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    })

    res.json({ data: users.map(toUserDto), error: null })
  })
)

export default router
