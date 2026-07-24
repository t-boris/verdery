import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The relay's own integration test starts a real PostgreSQL/PostGIS
    // container, which is far slower than the default five-second budget —
    // matching services/api/vitest.config.ts's own identical setting and the
    // exact reason it gives.
    // Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
