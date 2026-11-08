import { defineConfig } from 'vitest/config';

// End-to-end tests drive a real Edge/Chrome and may download the Minecraft assets,
// so they are excluded from the default config and run on demand with `pnpm test:e2e`.
export default defineConfig({
  test: {
    globals: false,
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000
  }
});
