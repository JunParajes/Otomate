import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { loginSchema } from '@otomate/shared'
import { prisma } from '../prisma/client'
import { signToken } from '../lib/jwt'
import { asyncHandler } from '../middleware/async-handler'
import { HttpError } from '../middleware/error-handler'

const router = Router()

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input', 'VALIDATION_ERROR')
    }

    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: true } } },
    })

    if (!user || !user.isActive) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
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
)

export default router
