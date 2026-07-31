import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: [
        'src/main/**/*.ts',
        'src/preload/**/*.ts',
        'src/renderer/src/**/*.{ts,tsx}',
        'src/shared/**/*.ts'
      ],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/renderer/src/env.d.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90
      }
    }
  }
})
