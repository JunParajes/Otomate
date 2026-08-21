import jwt from 'jsonwebtoken'
import type { AuthTokenPayload } from '@otomate/shared'

const secret = process.env.JWT_SECRET

if (!secret || secret.length < 32) {
  // Fail at boot rather than on the first login attempt.
  throw new Error('JWT_SECRET is missing or shorter than 32 characters')
}

/** Identity only — authority is read from the database per request. */
export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret as string, { expiresIn: '7d' })
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, secret as string) as AuthTokenPayload
}
