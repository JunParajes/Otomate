import type { Request } from 'express'
import { HttpError } from '../middleware/error-handler'

/**
 * @types/express@5 types path params as `string | string[]` (wildcards can
 * repeat). Narrow once, here, rather than casting at every call site — and
 * reject an empty/missing param as a 400 instead of letting it reach Prisma.
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
