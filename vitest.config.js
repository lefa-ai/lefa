import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['api/**/*.test.js', 'site/**/*.test.js'],
    coverage: {
      include: ['api/waitlist.js'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95
      }
    }
  }
})
