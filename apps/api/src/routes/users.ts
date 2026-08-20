import { Router } from 'express'
import { prisma } from '../prisma/client'
import { authenticate, requirePermission } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { HttpError } from '../middleware/error-handler'

const router = Router()

router.use(authenticate)

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { role: { include: { permissions: true } }, branch: true },
    })

    if (!user) {
      throw new HttpError(404, 'User not found', 'NOT_FOUND')
    }

    const { password: _, ...safeUser } = user
    res.json({ data: safeUser, error: null })
  })
)

router.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      include: { role: true, branch: true },
      orderBy: { createdAt: 'desc' },
    })

    const safe = users.map(({ password: _, ...u }) => u)
    res.json({ data: safe, error: null })
  })
)

export default router
