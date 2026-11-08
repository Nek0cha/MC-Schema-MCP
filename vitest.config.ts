import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test file imports describe/it/expect explicitly, so globals
    // stays off deliberately rather than inviting ambient reliance.
    globals: false,
    passWithNoTests: true,
    // Slow performance tests run on demand via `pnpm test:perf`.
    exclude: [...configDefaults.exclude, 'test/perf/**']
  },
});
