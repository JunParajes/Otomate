import type { Request } from 'express'
import { HttpError } from '../middleware/error-handler'

/**
 * A path param, or a 400.
 *
 * This began as a workaround for @types/express@5 typing params as
 * `string | string[]` while express@4 ran underneath. The types are aligned now
 * and `req.params.id` is plainly `string` — but that type is a lie: a param the
 * route never declared is `undefined` at runtime, and TypeScript will not say
 * so. Handing that to Prisma produces an error pointing at the query rather than
 * at the missing id.
 *
 * So this stays, for the runtime check rather than the cast.
 */
export function pathParam(req: Request, key: string): string {
  const value = req.params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `Missing or invalid '${key}' parameter`, 'VALIDATION_ERROR')
  }
  return value
}

/** Surfaces the first Zod issue so the UI shows something specific. */
export function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Invalid input'
}
