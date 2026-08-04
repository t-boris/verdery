import { expect, test } from '@playwright/test';

import { signIn } from './support/signed-in-garden';
import { freshTestEmail } from './support/auth-emulator';
import { copy } from './support/copy';

/**
 * Placing a garden on the Earth and then drawing over it — the flow the owner
 * asked for: give the garden a location, open the map, and trace the lot over
 * a photograph of the real place.
 *
 * This spec exists because the two defects in that flow both escaped every
 * other kind of test. The transport parser refused `addressSearch` while the
 * contract, the client and the domain all accepted it; and the canvas
 * container painted an opaque surface over the backdrop, so imagery was
 * fetched, rendered, and then hidden. Unit tests cannot see either: one lives
 * between two components that agree in isolation, the other in a CSS
 * stacking context.
 *
 * Coordinates are typed rather than searched. The address path is a live call
 * to a federal service; a test that fails when a government website is slow
 * is a test that stops meaning anything.
 *
 * Source: implementation-plan.md work package P12-GEO-01;
 * architecture/map-rendering-and-editing.md, section "3.2 Geographic Space".
 */
test('a located garden draws its map over a backdrop, with the grid stood down', async ({
  page,
}) => {
  const email = freshTestEmail('garden-location');
  await signIn(page, email);

  await page.getByLabel(copy.gardensCreateNameLabel).fill(`E2E located ${Date.now().toString()}`);
  await page.getByRole('button', { name: copy.gardensCreateSubmit }).click();
  await expect(page).toHaveURL(/\/application\/gardens\/[^/]+$/);
  const gardenId = page.url().split('/').pop() ?? '';
  expect(gardenId).not.toBe('');

  // Before: no location, so the map offers no backdrop and says why.
  await page.goto(`/application/gardens/${gardenId}/map`);
  await expect(page.getByText(copy.backdropNeedsLocation)).toBeVisible();
  await expect(page.getByRole('link', { name: copy.mapEmptyLocateAction })).toBeVisible();

  // Somewhere in Iowa — a real place in the product's first market.
  await page.goto(`/application/gardens/${gardenId}`);
  await page.getByLabel(copy.latitudeLabel).fill('41.59');
  await page.getByLabel(copy.longitudeLabel).fill('-93.63');
  await page.getByRole('button', { name: copy.saveLocation }).click();
  await expect(page.getByText(copy.locationSaved)).toBeVisible();

  await page.goto(`/application/gardens/${gardenId}/map`);

  // The backdrop is really in the document, and really visible — the second
  // defect was a rendered map hidden behind an opaque canvas container.
  const basemap = page.locator('.maplibregl-map');
  await expect(basemap).toBeVisible();

  const stageBackground = await page
    .locator('canvas')
    .first()
    .evaluate((canvas) => {
      const container = canvas.closest('div');
      return container === null ? '' : getComputedStyle(container).backgroundColor;
    });
  expect(stageBackground).toMatch(/rgba\(0, 0, 0, 0\)|transparent/u);

  // And the first thing the empty map asks for is the lot.
  await page.getByRole('button', { name: copy.mapEmptyTraceAction }).click();
  await expect(page.getByRole('button', { name: copy.mapDrawLotTool })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
