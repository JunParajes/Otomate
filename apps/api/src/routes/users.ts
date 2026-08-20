import { Router } from 'express'
import { prisma } from '../prisma/client.js'
import { authenticate, requirePermission } from '../middleware/auth.js'

const router = Router()

router.use(authenticate)

router.get('/me', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { role: { include: { permissions: true } }, branch: true },
  })

  if (!user) {
    res.status(404).json({ data: null, error: { message: 'User not found' } })
    return
  }

  const { password: _, ...safeUser } = user
  res.json({ data: safeUser, error: null })
})

router.get('/', requirePermission('users:read'), async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { role: true, branch: true },
    orderBy: { createdAt: 'desc' },
  })

  const safe = users.map(({ password: _, ...u }) => u)
  res.json({ data: safe, error: null })
})

export default router
