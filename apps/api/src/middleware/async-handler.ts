import type { Request, Response, NextFunction, RequestHandler } from 'express'

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

/**
 * Express 4 does not catch rejected promises from async handlers — an unhandled
 * rejection terminates the process under Node's default policy. Wrapping routes
 * routes the rejection into the error middleware instead.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
