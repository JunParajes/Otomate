import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma/client.js'
import { signToken } from '../lib/jwt.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { message: 'Invalid input', code: 'VALIDATION_ERROR' } })
    return
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: { include: { permissions: true } } },
  })

  if (!user || !user.isActive) {
    res.status(401).json({ data: null, error: { message: 'Invalid credentials' } })
    return
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    res.status(401).json({ data: null, error: { message: 'Invalid credentials' } })
    return
  }

  const permissions = user.role.permissions.map(p => p.name)
  const token = signToken({ userId: user.id, roleId: user.roleId, permissions })

  res.json({
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
        role: { id: user.role.id, name: user.role.name },
        branchId: user.branchId,
      },
    },
    error: null,
  })
})

export default router
