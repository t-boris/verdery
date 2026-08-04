import { expect, test, type BrowserContext } from '@playwright/test';

import { fetchEmailSignInLink, freshTestEmail } from './support/auth-emulator';
import { copy } from './support/copy';

/**
 * What happens when the API stops accepting the session cookie mid-visit.
 *
 * Both halves of that answer are behaviour a person meets in the real
 * product, and both were missing until 2026-08-04: the client had no
 * handling for `auth.unauthenticated` at all, so an expired cookie produced
 * a screen that simply never finished loading.
 *
 * The cookie is replaced with a value the API cannot verify rather than
 * waited out — a session cookie's real lifetime is measured in days, and a
 * test that sleeps for it proves nothing a forged value does not.
 *
 * Source: architecture/identity-and-authorization.md, sections
 * "5. Web Session Flow" and "9. Session Lifecycle"; `apps/web/proxy.ts`.
 */

const SESSION_COOKIE_NAME = '__session';

async function replaceSessionCookie(context: BrowserContext, baseURL: string): Promise<void> {
  const { hostname } = new URL(baseURL);

  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: 'not-a-session-this-api-can-verify',
      domain: hostname,
      path: '/',
    },
  ]);
}

test('a still-signed-in browser recovers its own session without asking again', async ({
  page,
  context,
  baseURL,
}) => {
  const email = freshTestEmail('session-recovery');

  await page.goto('/auth/sign-in');
  await page.getByLabel(copy.emailLabel).fill(email);
  await page.getByRole('button', { name: copy.emailSubmit }).click();
  await expect(page.getByText(copy.emailLinkSent)).toBeVisible();

  const link = await fetchEmailSignInLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/application\/gardens$/);

  // The Firebase credential in this browser outlives the session cookie, so
  // the client can mint a new cookie by itself. Nobody should be asked to
  // sign in again for that.
  await replaceSessionCookie(context, baseURL ?? 'http://localhost:3000');
  await page.goto('/application/gardens');

  await expect(page.getByRole('heading', { name: copy.gardensTitle })).toBeVisible();
  await expect(page).toHaveURL(/\/application\/gardens$/);
});

test('a browser with no credential is returned to sign-in, once, and told why', async ({
  page,
  context,
  baseURL,
}) => {
  // Never signed in: there is no Firebase user to refresh from, so recovery
  // must fail and hand over to sign-in.
  await replaceSessionCookie(context, baseURL ?? 'http://localhost:3000');

  await page.goto('/application/gardens');

  // The loop this asserts against: `proxy.ts` sends anyone HOLDING a session
  // cookie away from sign-in, and the cookie here cannot be cleared (its
  // CSRF partner is missing, so logout is refused). Without the
  // `sessionExpired` marker the browser would bounce between the two routes.
  await expect(page).toHaveURL(/\/auth\/sign-in\?/);
  await expect(page.getByText(copy.sessionExpired)).toBeVisible();
  await expect(page.getByRole('heading', { name: copy.signInTitle })).toBeVisible();

  const landed = new URL(page.url());
  expect(landed.searchParams.get('next')).toBe('/application/gardens');
});
