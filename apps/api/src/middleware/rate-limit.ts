import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'

/**
 * The app is publicly reachable through the Cloudflare tunnel, and
 * POST /api/auth/login is unauthenticated and runs bcrypt at cost 12. Slow by
 * design — which makes it both a brute-force target and a cheap way for a
 * stranger to burn CPU on a home server.
 */

/**
 * Requests reach this API by two routes, and they need different treatment:
 *
 *   internet → Cloudflare → cloudflared container → Traefik → here
 *   LAN      → Traefik → here
 *
 * Over the tunnel, every request arrives at Traefik from the same cloudflared
 * container, so X-Forwarded-For ends in one address for the entire internet and
 * is useless as a key. Cloudflare sets CF-Connecting-IP at its edge and rejects
 * (403) any request that arrives carrying one, so on that route the header is
 * both correct and unforgeable — verified against production.
 *
 * On the LAN there is no Cloudflare, so nothing stops a local client inventing
 * the header and collecting a fresh allowance for every value it makes up.
 * Hence: the header is trusted **only** when the immediate peer is a container
 * on the Docker network, which is the only way tunnel traffic can arrive.
 * A LAN client cannot make its packets appear to come from there.
 */
const DOCKER_BRIDGE = /^(?:::ffff:)?172\.(1[6-9]|2\d|3[01])\./

function isTunnelPeer(ip: string | undefined): boolean {
  return !!ip && DOCKER_BRIDGE.test(ip)
}

let lastForgeryLog = 0

/**
 * ipKeyGenerator() collapses IPv6 addresses to their /56 subnet. Without it a
 * single visitor walks their own prefix for a fresh allowance on every request,
 * which makes an IPv6 limit decorative.
 */
function clientKey(req: Request): string {
  const claimed = req.get('cf-connecting-ip')

  if (claimed && !isTunnelPeer(req.ip)) {
    // Either someone on the LAN is trying to shake off a limit, or the tunnel
    // stopped arriving from where we expect — which would silently put the whole
    // internet in one bucket. Both are worth seeing. Throttled so a determined
    // forger cannot flood the log.
    const now = Date.now()
    if (now - lastForgeryLog > 60_000) {
      lastForgeryLog = now
      console.warn(
        `[rate-limit] ignoring CF-Connecting-IP from non-tunnel peer ${req.ip} — ` +
          'expected a 172.16/12 container address. If this is normal tunnel ' +
          'traffic, the Docker network changed and clientKey() needs updating.'
      )
    }
  }

  const source = (isTunnelPeer(req.ip) && claimed) || req.ip || 'unknown'
  return ipKeyGenerator(source)
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
  /*
   * Overridable, for the browser suite only.
   *
   * The default protects a machine that also serves eleven branches, and no
   * screen comes anywhere near it. The Playwright server is a different case:
   * it is reused between local runs, so its counter carries across them, and a
   * suite that has grown past seventy tests eventually spends the whole window
   * — at which point the LAST test fails with "Could not load", which reads
   * like a broken page rather than a spent allowance. That cost an hour to
   * find, twice.
   *
   * Raised by the value in the environment rather than skipped when NODE_ENV is
   * test: the API's own integration tests run as NODE_ENV=test too, and they
   * should keep meeting the real limiter.
   */
  limit: Number(process.env.API_RATE_LIMIT ?? 1000),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: envelope('Too many requests. Slow down and try again shortly.'),
})

/**
 * Clears both limiters' counters.
 *
 * For tests only. The stores are in-memory and per-process, so a suite that
 * exercises failed sign-ins would otherwise exhaust the 10-per-15-minutes
 * allowance and start getting 429s that look like auth failures.
 *
 * Deliberately not wired to any route or environment variable — nothing can
 * reach it over the network.
 */
export function resetRateLimitsForTests(): void {
  authLimiter.resetKey?.('')
  apiLimiter.resetKey?.('')
  ;(authLimiter as unknown as { store?: { resetAll?: () => void } }).store?.resetAll?.()
  ;(apiLimiter as unknown as { store?: { resetAll?: () => void } }).store?.resetAll?.()
}
