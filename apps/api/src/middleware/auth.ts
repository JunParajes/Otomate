import type { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt.js'
import type { AuthTokenPayload } from '@otomate/shared'

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ data: null, error: { message: 'Missing or invalid token' } })
    return
  }

  try {
    req.user = verifyToken(header.slice(7))
    next()
  } catch {
    res.status(401).json({ data: null, error: { message: 'Token expired or invalid' } })
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.permissions.includes(permission)) {
      res.status(403).json({ data: null, error: { message: 'Insufficient permissions' } })
      return
    }
    next()
  }
}
