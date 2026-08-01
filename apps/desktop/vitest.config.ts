import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  test: {
    coverage: {
      include: [
        'src/main/**/*.ts',
        'src/preload/**/*.ts',
        'src/renderer/src/**/*.{ts,tsx}',
        'src/shared/**/*.ts'
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/renderer/src/env.d.ts',
        // Vendored shadcn/ui components — third-party code we don't own or test.
        'src/renderer/src/components/ui/**',
        'src/renderer/src/lib/utils.ts'
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90
      }
    }
  }
})
