import { expect, test } from '@playwright/test';

import { fetchEmailSignInLink, freshTestEmail } from './support/auth-emulator';
import { copy } from './support/copy';

/**
 * Signs in independently of the register/reopen spec — this scenario only
 * needs *a* signed-in session, not the garden created elsewhere — then
 * proves sign-out is a real, server-observed state change: a direct
 * navigation to a protected route afterward must still bounce to sign-in
 * (`apps/web/proxy.ts`), not merely have hidden the sign-out button.
 *
 * Source: architecture/identity-and-authorization.md, section "5. Web
 * Session Flow", step 6 ("Logout clears the cookie and may revoke refresh
 * tokens"); docs/implementation-plan.md, work package P2-QA-01.
 */
test('sign out clears the session and protected routes redirect to sign-in', async ({ page }) => {
  const email = freshTestEmail('sign-out');

  await page.goto('/auth/sign-in');
  await page.getByLabel(copy.emailLabel).fill(email);
  await page.getByRole('button', { name: copy.emailSubmit }).click();
  await expect(page.getByText(copy.emailLinkSent)).toBeVisible();

  const link = await fetchEmailSignInLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/application\/gardens$/);

  await page.getByRole('button', { name: copy.signOut }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);

  await page.goto('/application/gardens');

  const redirectedUrl = new URL(page.url());
  expect(redirectedUrl.pathname).toBe('/auth/sign-in');
  expect(redirectedUrl.searchParams.get('next')).toBe('/application/gardens');
});
