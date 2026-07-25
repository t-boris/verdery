import { expect, type Page } from '@playwright/test';

import { fetchEmailSignInLink, freshTestEmail } from './auth-emulator';
import { copy } from './copy';
import { fetchPlantId, seedCareLoopCandidates } from './recommendation-seed';

/**
 * One signed-in account with a garden that has something on every page.
 *
 * The accessibility, keyboard, and responsive suites all need the same
 * precondition: a real session, and routes that are *populated*, because an
 * empty list has no rows to check and an empty Today has no cards. Rather
 * than each spec re-deriving that setup, it lives here once.
 *
 * The sign-in path is the email magic link, for the same reason
 * `register-and-create-garden.spec.ts` chose it: it is the only one of the
 * three methods that completes deterministically with no popup and no
 * fake-IDP page.
 *
 * Source: architecture/testing-strategy.md, section 9; work package P8-UX-01.
 */

export interface SignedInGarden {
  readonly email: string;
  readonly gardenId: string;
  readonly gardenName: string;
  readonly plantName: string;
  readonly taskTitle: string;
}

/** Signs the given email in through the real magic-link flow. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByLabel(copy.emailLabel).fill(email);
  await page.getByRole('button', { name: copy.emailSubmit }).click();
  await expect(page.getByText(copy.emailLinkSent)).toBeVisible();
  // `EmailLinkCompletion` completes the sign-in and routes onward as soon as
  // it mounts, which sometimes cancels this navigation's own load event
  // (`net::ERR_ABORTED`). The redirect having already happened is the
  // success case, so the landing URL — asserted next — is the real signal,
  // not whether `goto` saw `load` fire.
  await page.goto(await fetchEmailSignInLink(email)).catch((error: unknown) => {
    if (!String(error).includes('ERR_ABORTED')) {
      throw error;
    }
  });
  await expect(page).toHaveURL(/\/application\/gardens$/);
}

/**
 * Creates the account, the garden, a plant, a manual task, an observation,
 * and the four seeded Today candidates, then returns the identifiers the
 * specs navigate by.
 *
 * Every step drives the real UI (and, for the recommendation candidates, the
 * real database through the same seeding helper the care-loop spec uses), so
 * the pages the audit then inspects hold data the application really
 * produced rather than fixtures injected into the DOM.
 */
export async function createPopulatedGarden(page: Page, label: string): Promise<SignedInGarden> {
  const email = freshTestEmail(label);
  const gardenName = `E2E ${label} garden ${Date.now().toString()}`;
  const plantName = 'E2E Rhubarb bed';
  const taskTitle = 'E2E Mulch the north border';

  await signIn(page, email);

  await page.getByLabel(copy.gardensCreateNameLabel).fill(gardenName);
  await page.getByRole('button', { name: copy.gardensCreateSubmit }).click();
  await expect(page).toHaveURL(/\/application\/gardens\/[^/]+$/);
  const gardenId = page.url().split('/').pop() ?? '';
  expect(gardenId).not.toBe('');

  await page.goto(`/application/gardens/${gardenId}/plants`);
  await page.getByLabel(copy.plantDisplayNameLabel).fill(plantName);
  await page.getByRole('button', { name: copy.plantAddSubmit }).click();
  await expect(page).toHaveURL(/\/plants\/[^/]+$/);

  // An observation, recorded on the plant's own page where the form is
  // already scoped to it.
  // `exact` matters: the plant page also shows "Condition note" and "Care
  // guidance note", both of which contain "Note".
  await page
    .getByLabel(copy.observationNoteLabel, { exact: true })
    .fill('E2E leaves look healthy.');
  await page.getByRole('button', { name: copy.observationSubmit }).click();
  await expect(page.getByText('E2E leaves look healthy.')).toBeVisible();

  await page.goto(`/application/gardens/${gardenId}/tasks`);
  await page.getByLabel(copy.taskTitleLabel).fill(taskTitle);
  await page.getByRole('button', { name: copy.taskCreateSubmit }).click();
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible();

  await seedCareLoopCandidates(gardenId, await fetchPlantId(gardenId));

  return { email, gardenId, gardenName, plantName, taskTitle };
}

/** Every route the E2E harness can reach, as a path and a stable name. */
export function auditedRoutes(gardenId: string): readonly { name: string; path: string }[] {
  const base = `/application/gardens/${gardenId}`;
  return [
    { name: 'sign-in', path: '/auth/sign-in' },
    { name: 'gardens', path: '/application/gardens' },
    { name: 'garden overview', path: base },
    { name: 'today', path: `${base}/today` },
    { name: 'map', path: `${base}/map` },
    { name: 'plants', path: `${base}/plants` },
    { name: 'observations', path: `${base}/observations` },
    { name: 'tasks', path: `${base}/tasks` },
    { name: 'status', path: '/status' },
  ];
}

/**
 * Waits until the route has finished its first client-side fetch.
 *
 * Every authenticated page renders `role="status"` loading text first and
 * fills in from TanStack Query afterwards. Auditing before that resolves
 * would check an empty shell — the exact opposite of what these suites are
 * for. The map additionally mounts Konva through `next/dynamic`, which is a
 * second, later paint.
 */
export async function waitForRouteContent(page: Page, path: string): Promise<void> {
  await page.waitForLoadState('networkidle');

  if (path.endsWith('/map')) {
    // The Konva stage container carries the canvas role; its presence is the
    // signal that the dynamically imported editor has actually mounted.
    await expect(page.getByRole('application')).toBeVisible({ timeout: 20_000 });
  }

  await expect(page.locator('p[role="status"]')).toHaveCount(0, { timeout: 20_000 });
}
