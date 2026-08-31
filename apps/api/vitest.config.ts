import { defineConfig } from 'vitest/config'

// Deliberately a zone WEST of Greenwich.
//
// A DATE column comes back from Prisma as UTC midnight. Read with getDate()
// instead of getUTCDate() that is the previous day for anyone behind UTC — the
// bug the serializer's dateOnly() exists to avoid. Both the dev machines here
// (UTC+8) and GitHub's runners (UTC) are at or ahead of Greenwich, where the
// two agree and the bug is invisible. Pinning the zone is what makes the date
// tests able to fail at all.
process.env.TZ = 'America/Los_Angeles'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'prisma/**/*.test.ts'],
    // These share one Postgres and truncate between tests, so they must not run
    // concurrently — parallel files would delete each other's rows mid-assertion.
    fileParallelism: false,
    // A first run pays for `prisma migrate deploy`.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
