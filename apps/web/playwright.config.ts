import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the browser E2E suite (work package P2-QA-01).
 *
 * There is no `webServer` entry here on purpose: the API, the Auth emulator,
 * and the web app itself are started, health-checked, and torn down by
 * `e2e/run-e2e.sh`, which also owns the throwaway Postgres those depend on.
 * Folding server lifecycle into this config as well would mean two different
 * places deciding when those processes start and stop; the shell script is
 * the one place, matching this repository's existing orchestration-script
 * convention (`infrastructure/gcloud/scripts/`).
 *
 * Source: architecture/testing-strategy.md, section 9 ("Playwright for
 * browser end-to-end behavior"); section 20 ("Register and create first
 * garden" — this suite's Phase 2 scope).
 */
const baseURL = process.env['E2E_WEB_BASE_URL'] ?? 'http://localhost:3000';
const isCI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // Every spec drives the same Auth emulator and the same API/Postgres
  // instance; running them in parallel would make failures depend on
  // scheduling order instead of the behavior under test. Kept single-worker
  // for now — the suite is small enough that this costs little wall time.
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,

  reporter: [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pinned so the app's Accept-Language-based locale negotiation
    // (shared/localization/locales.ts) deterministically resolves to English
    // regardless of the machine this suite runs on — the specs assert
    // against English copy (e2e/support/copy.ts).
    locale: 'en-US',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
