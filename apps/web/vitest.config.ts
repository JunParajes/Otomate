import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src only, and EXPLICITLY not e2e.
    //
    // Without this, vitest's default include (**/*.spec.ts among others) sweeps
    // up the Playwright specs, tries to run them as unit tests, and fails with
    // "calling test.describe() from an async test.describe() block" — which says
    // nothing about the real problem. That broke CI on the commit that added
    // them, while passing locally where a stale .fixtures.json happened to exist.
    //
    // packages/shared and apps/api both set an explicit include; web was the one
    // left on defaults.
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
