import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { loginSchema, changeOwnPasswordSchema } from '@otomate/shared'
import { prisma } from '../prisma/client'
import { signToken } from '../lib/jwt'
import { toUserDto } from '../lib/serializers'
import { asyncHandler } from '../middleware/async-handler'
import { HttpError } from '../middleware/error-handler'
import { authenticate } from '../middleware/auth'

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
      include: { role: true, branch: true },
    })

    // Same message and same code path whether the email is unknown, the account
    // is disabled, or the password is wrong — don't leak which.
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.password))) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      include: { role: true, branch: true },
    })

    res.json({
      data: { token: signToken({ userId: user.id }), user: toUserDto(updated) },
      error: null,
    })
  })
)

/** Self-service password change — also clears the forced-change flag. */
router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const parsed = changeOwnPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid input', 'VALIDATION_ERROR')
    }

    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } })
    if (!user) {
      throw new HttpError(404, 'User not found', 'NOT_FOUND')
    }

    if (!(await bcrypt.compare(parsed.data.currentPassword, user.password))) {
      throw new HttpError(400, 'Current password is incorrect', 'INVALID_CREDENTIALS')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(parsed.data.newPassword, 12),
        mustChangePassword: false,
      },
    })

    res.json({ data: { success: true }, error: null })
  })
)

export default router
