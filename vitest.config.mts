import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/main/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30_000,
  },
});
