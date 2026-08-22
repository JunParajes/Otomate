import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'

/**
 * The app is publicly reachable through the Cloudflare tunnel, and
 * POST /api/auth/login is unauthenticated and runs bcrypt at cost 12. Slow by
 * design — which makes it both a brute-force target and a cheap way for a
 * stranger to burn CPU on a home server.
 */

/**
 * Cloudflare *overwrites* CF-Connecting-IP at its edge, so a client cannot forge
 * it — unlike X-Forwarded-For, which anyone may prepend to. LAN traffic reaches
 * Traefik directly, has no such header, and falls back to req.ip (see
 * `trust proxy` in index.ts).
 *
 * ipKeyGenerator() collapses IPv6 addresses to their /56 subnet. Without it a
 * single visitor can walk their own prefix and get a fresh allowance for every
 * request, which makes an IPv6 limit decorative.
 */
function clientKey(req: Request): string {
  return ipKeyGenerator(req.get('cf-connecting-ip') || req.ip || 'unknown')
}

const envelope = (message: string) => ({
  data: null,
  error: { message, code: 'RATE_LIMITED' },
})

/**
 * Failed sign-ins. `skipSuccessfulRequests` means a normal day of signing in
 * never counts against anyone — only guessing does.
 *
 * Keyed by IP rather than by email on purpose: an attacker hammering one
 * account exhausts their *own* allowance and cannot lock the real user out
 * from somewhere else.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: envelope('Too many failed sign-in attempts. Try again in a few minutes.'),
})

/**
 * A deliberately generous flood backstop for the rest of the API. Set well
 * above real use — a DSIR screen pulls products, employees, branches and the
 * report on open — so it only ever trips on abuse.
 *
 * Not applied to /health (container healthchecks) or /uploads (static images,
 * many per page and cached immutably).
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: envelope('Too many requests. Slow down and try again shortly.'),
})
