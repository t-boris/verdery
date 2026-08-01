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
    // One authoritative Docker probe per run, handed to every fork —
    // see tests/support/global-setup.ts (P7-QA-01).
    globalSetup: ['tests/support/global-setup.ts'],
    // Runs inside every fork, before any test module is imported, so each
    // `new pg.Pool(...)` carries an 'error' listener — see
    // tests/support/pool-shutdown-guard.ts for the teardown race it closes.
    setupFiles: ['tests/support/pool-shutdown-guard.ts'],
  },
});
