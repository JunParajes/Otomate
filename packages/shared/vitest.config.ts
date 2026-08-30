import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src only. dist holds compiled copies of everything, and picking those up
    // would run every test twice and report the count doubled.
    include: ['src/**/*.test.ts'],
  },
})
