import { expect, test } from '@playwright/test';

import { copy } from './support/copy';

/**
 * Google sign-in through the Auth emulator's fake IDP picker.
 *
 * Connecting the client SDK to the Auth emulator (`connectAuthEmulator`, see
 * `core/auth/firebase-app.ts`) makes `signInWithPopup` open the emulator's
 * OWN account-chooser page instead of a real Google popup — ordinary,
 * scriptable HTML served by the emulator, confirmed by actually running this
 * flow and inspecting the popup's DOM while building this suite (not guessed
 * from memory): a list with an "Add new account" item, a plain form with
 * `#email-input` / `#display-name-input` inputs (their `aria-labelledby`
 * references a non-existent id, so `getByLabel` cannot find them — hence the
 * `#id` locators below), and a `#sign-in` submit button.
 *
 * This is intentionally a smoke test, not the primary trusted scenario: the
 * fake-IDP page is third-party HTML this repository does not own, so the
 * assertion is the weakest one that still proves the button reaches a
 * working session (lands on the authenticated gardens list), not every
 * detail of the fake-IDP form. If this ever becomes flaky in CI, that is a
 * property of the emulator's own popup lifecycle, not of the application
 * under test — see the honest reporting note in this work package's summary
 * rather than tightening this assertion to paper over it.
 *
 * Source: docs/implementation-plan.md, work package P2-QA-01 ("Google
 * sign-in via the emulator's fake IDP picker, at least smoke-testing that
 * the button reaches a working session").
 */
test('Google sign-in through the Auth emulator fake IDP reaches a working session', async ({
  page,
  context,
}) => {
  await page.goto('/auth/sign-in');

  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: copy.signInWithGoogle }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  // Always provisions a brand-new fake identity, so this test never depends
  // on what earlier runs left in the emulator's account list.
  await popup.getByRole('button', { name: 'Add new account' }).click();
  await popup.locator('#email-input').fill(`e2e-google-${Date.now().toString()}@example.com`);
  await popup.locator('#sign-in').click();

  await expect(page).toHaveURL(/\/application\/gardens$/, { timeout: 15_000 });
});
