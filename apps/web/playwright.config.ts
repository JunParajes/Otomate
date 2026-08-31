import { defineConfig } from '@playwright/test'

/**
 * Browser tests, kept deliberately small.
 *
 * The arithmetic and the permission gating are covered by faster tests. What is
 * left for a browser is behaviour that only exists in one: focus handling, a
 * stale closure in an input hook, session state that has to refresh after a
 * write, and navigation. Every test here maps to something that has actually
 * broken in this app.
 *
 * Uses the INSTALLED Chrome (`channel: 'chrome'`) rather than Playwright's
 * bundled Chromium — its CDN is unreachable from the dev network here, and
 * GitHub's ubuntu runners ship Chrome anyway.
 */
const API_PORT = process.env.E2E_API_PORT ?? '3994'
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5992'

export default defineConfig({
  testDir: './e2e',
  // These share one database and one seeded fixture set.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome',
    // Landscape tablet: what this is actually used on.
    viewport: { width: 1180, height: 820 },
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },

  webServer: [
    {
      command: `pnpm --filter api exec ts-node-dev --transpile-only src/index.ts`,
      cwd: '../..',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        API_PORT,
        DATABASE_URL: process.env.DATABASE_URL ?? '',
        JWT_SECRET: process.env.JWT_SECRET ?? '',
        NODE_ENV: 'test',
      },
    },
    {
      // The built app, not the dev server: this is what actually ships, and a
      // production build is where a missing dependency or a dead code path shows.
      //
      // The BUILD has to happen here, with VITE_API_URL set. Vite bakes that
      // value into the bundle at build time, so setting it on `preview` alone
      // does nothing — the app then calls whatever host it was compiled
      // against, and every request fails with no clue why.
      command: `pnpm exec vite build && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
})
