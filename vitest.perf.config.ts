import { defineConfig } from 'vitest/config';

// Performance tests are slow and machine-dependent, so they are excluded from
// the default config and run on demand with `pnpm test:perf`.
export default defineConfig({
  test: {
    globals: false,
    include: ['test/perf/**/*.test.ts'],
    testTimeout: 120_000
  }
});
