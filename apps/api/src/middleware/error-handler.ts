import type { Request, Response, NextFunction } from 'express'
import { MulterError } from 'multer'
import { Prisma } from '@prisma/client'

/**
 * Error with an explicit HTTP status, for failures a route knows how to describe.
 * Anything else that reaches the handler is treated as a 500 and logged.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Terminal 404 for unmatched routes. Mounted after every router. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ data: null, error: { message: 'Not found', code: 'NOT_FOUND' } })
}

/**
 * Express identifies error middleware by arity, so all four parameters must stay
 * declared even when unused. Mounted last, after notFoundHandler.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  // A partially-sent response can't be rewritten — let Express abort the socket.
  if (res.headersSent) {
    next(err)
    return
  }

  // express.json() rejects malformed bodies with a SyntaxError carrying `body`.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ data: null, error: { message: 'Malformed JSON body', code: 'VALIDATION_ERROR' } })
    return
  }

  // multer rejects oversized uploads before any route runs.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'That image is too large (maximum 8 MB)'
        : `Upload failed: ${err.message}`
    res.status(400).json({ data: null, error: { message, code: 'UPLOAD_ERROR' } })
    return
  }

  // P2003 = foreign key constraint failed. That is always a bad reference in the
  // request, not a server fault — routes should catch it explicitly with a better
  // message, but this stops one ever surfacing as a 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    res.status(400).json({
      data: null,
      error: { message: 'A referenced record does not exist', code: 'INVALID_REFERENCE' },
    })
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ data: null, error: { message: err.message, code: err.code } })
    return
  }

  console.error('[error]', err)
  res.status(500).json({
    data: null,
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  })
}
