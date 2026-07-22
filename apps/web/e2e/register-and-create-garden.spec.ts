import { expect, test } from '@playwright/test';

import { fetchEmailSignInLink, freshTestEmail } from './support/auth-emulator';
import { copy } from './support/copy';

/**
 * Primary, most-trusted E2E path: email magic-link sign-in is the only one of
 * the three initial sign-in methods that is fully deterministic end to end —
 * a real link, fetched from the Auth emulator's own REST API, with no popup
 * and no fake-IDP page in the loop.
 *
 * The two tests below share one email address on purpose: the second is only
 * a meaningful "reopen" check if it proves the SAME account, provisioned by
 * the first test's first-ever sign-in, still owns the SAME garden.
 *
 * Source: architecture/testing-strategy.md, section 20, "Register and create
 * first garden"; docs/implementation-plan.md, work package P2-QA-01.
 */
test.describe.serial('email magic link: register, create a garden, and reopen it', () => {
  const email = freshTestEmail('register');
  const gardenName = `E2E Backyard ${Date.now().toString()}`;

  test('first-ever sign-in provisions a profile and creates the first garden', async ({ page }) => {
    await page.goto('/auth/sign-in');

    await page.getByLabel(copy.emailLabel).fill(email);
    await page.getByRole('button', { name: copy.emailSubmit }).click();
    await expect(page.getByText(copy.emailLinkSent)).toBeVisible();

    const link = await fetchEmailSignInLink(email);
    await page.goto(link);

    // ProvisionProfile (services/api) creates the profile as a side effect of
    // this being the first session this Firebase UID has ever established —
    // there is no separate "register" endpoint to call, so landing on the
    // (empty) gardens list is the observable proof of registration.
    await expect(page).toHaveURL(/\/application\/gardens$/);
    await expect(page.getByRole('heading', { name: copy.gardensTitle })).toBeVisible();
    await expect(page.getByText(copy.gardensEmpty)).toBeVisible();

    await page.getByLabel(copy.gardensCreateNameLabel).fill(gardenName);
    await page.getByRole('button', { name: copy.gardensCreateSubmit }).click();

    // CreateGardenForm navigates to the new garden's own page on success.
    await expect(page).toHaveURL(/\/application\/gardens\/[^/]+$/);
  });

  test('signing in again as the same user still lists the garden created above', async ({
    page,
  }) => {
    // A fresh browser context — Playwright's default per-test isolation
    // gives this test no cookies and no localStorage from the test above.
    // That is deliberate: it exercises the same "new browser session" path
    // `EmailLinkCompletion` documents for a link opened somewhere the
    // pending email was never stored, proving persistence through the
    // account and the database, not through a carried-over session.
    await page.goto('/auth/sign-in');

    await page.getByLabel(copy.emailLabel).fill(email);
    await page.getByRole('button', { name: copy.emailSubmit }).click();
    await expect(page.getByText(copy.emailLinkSent)).toBeVisible();

    const link = await fetchEmailSignInLink(email);
    await page.goto(link);

    await expect(page).toHaveURL(/\/application\/gardens$/);
    await expect(page.getByRole('link', { name: gardenName, exact: true })).toBeVisible();
  });
});
