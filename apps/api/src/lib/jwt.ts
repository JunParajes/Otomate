import jwt from 'jsonwebtoken'
import type { AuthTokenPayload } from '@otomate/shared'

const secret = process.env.JWT_SECRET!

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' })
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, secret) as AuthTokenPayload
}
