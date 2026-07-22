import { expect, test } from '@playwright/test';

import { AUTH_EMULATOR_ORIGIN, freshTestEmail } from './support/auth-emulator';
import { copy } from './support/copy';

/**
 * Provider-outage behavior, using the Auth emulator's own origin as the
 * stand-in for a real Firebase Authentication outage: every request the
 * Firebase client SDK would send is routed through this one origin once
 * `connectAuthEmulator` is active, so blocking it here blocks the whole
 * provider the same way a real outage would.
 *
 * The app must show a real, non-crashing error state rather than hang or
 * throw an unhandled exception — see `sign-in-panel.tsx`'s `onEmailSubmit`
 * catch block, which this test exercises against a genuinely broken network
 * path rather than a mocked rejection.
 *
 * Source: docs/implementation-plan.md, work package P2-QA-01 ("provider
 * outage behavior").
 */
test('a blocked Auth provider shows a sign-in error instead of hanging', async ({ page }) => {
  await page.route(`${AUTH_EMULATOR_ORIGIN}/**`, (route) => route.abort('connectionrefused'));

  await page.goto('/auth/sign-in');
  await page.getByLabel(copy.emailLabel).fill(freshTestEmail('outage'));
  await page.getByRole('button', { name: copy.emailSubmit }).click();

  // Next.js's own route announcer (`#__next-route-announcer__`) also carries
  // `role="alert"`, so the locator is narrowed to the one that actually
  // contains the failure copy rather than matching either element.
  await expect(page.getByRole('alert').filter({ hasText: copy.signInFailed })).toBeVisible();

  // The page must still be interactive — a genuinely hung or crashed state
  // would leave the retry button unusable.
  await expect(page.getByRole('button', { name: copy.emailSubmit })).toBeEnabled();
});
