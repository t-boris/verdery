import { expect, test } from '@playwright/test';

import { copy } from './support/copy';
import { createPopulatedGarden, waitForRouteContent } from './support/signed-in-garden';

// R00 CORE-007..010: real current forms and commands, without media/provider
// prerequisites. Each journey owns its account and garden, including retries.
test('map drawing and property edits persist after reloading', async ({ page }) => {
  const { gardenId } = await createPopulatedGarden(page, 'map-editing');
  await page.goto(`/application/gardens/${gardenId}/map`);
  await waitForRouteContent(page, '/map');
  await page.getByRole('button', { name: copy.mapDrawBedTool, exact: true }).click();

  const canvas = page.getByRole('application');
  // Konva treats rapid clicks on the stage as a double-click even at different
  // vertices. Separate gestures beyond its 400ms window to finish explicitly.
  await canvas.click({ position: { x: 120, y: 120 }, delay: 500 });
  await canvas.click({ position: { x: 260, y: 120 }, delay: 500 });
  await canvas.click({ position: { x: 260, y: 240 }, delay: 500 });
  await canvas.click({ position: { x: 120, y: 240 }, delay: 500 });
  await page.getByRole('button', { name: 'Finish shape', exact: true }).click();

  // The successful create command selects the new bed and opens Properties.
  await expect(page.getByText('Bed · Revision 1', { exact: true })).toBeVisible();
  await page.getByLabel('Label', { exact: true }).fill('R02 North bed');
  await page.getByLabel('Label', { exact: true }).press('Enter');
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();

  await page.reload();
  await waitForRouteContent(page, '/map');
  await page.getByRole('tab', { name: 'Objects', exact: true }).click();
  const row = page.getByRole('button', { name: 'Select R02 North bed, Bed', exact: true });
  await expect(row).toBeVisible();
  await row.focus();
  await row.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Objects', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toBeFocused();

  await page.reload();
  await waitForRouteContent(page, '/map');
  await page.getByRole('tab', { name: 'Objects', exact: true }).click();
  await row.click({ modifiers: ['Shift'] });
  await expect(page.getByRole('tab', { name: 'Objects', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toBeVisible();
});

test('plant, observation, and manual task remain available after reloading', async ({ page }) => {
  const garden = await createPopulatedGarden(page, 'records');
  const base = `/application/gardens/${garden.gardenId}`;

  await page.goto(`${base}/plants`);
  const plant = page.getByRole('link').filter({ hasText: garden.plantName });
  await expect(plant).toBeVisible();
  await plant.click();
  await expect(page.getByText('E2E leaves look healthy.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('E2E leaves look healthy.', { exact: true })).toBeVisible();

  await page.goto(`${base}/observations`);
  await expect(page.getByText('E2E leaves look healthy.', { exact: true })).toBeVisible();
  await page.goto(`${base}/tasks`);
  await expect(page.getByRole('heading', { name: garden.taskTitle, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: garden.taskTitle, exact: true })).toBeVisible();
});
