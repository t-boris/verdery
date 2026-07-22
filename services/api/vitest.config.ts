import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // Migration tests start a real PostgreSQL/PostGIS container, which is far
    // slower than the default five-second budget.
    // Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
