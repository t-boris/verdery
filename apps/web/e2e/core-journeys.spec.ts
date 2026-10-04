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
  await canvas.click({ position: { x: 120, y: 120 } });
  await canvas.click({ position: { x: 260, y: 120 } });
  await canvas.click({ position: { x: 260, y: 240 } });
  await canvas.click({ position: { x: 120, y: 240 } });
  await page.getByRole('button', { name: 'Finish shape', exact: true }).click();

  await page.getByRole('tab', { name: 'Objects', exact: true }).click();
  const object = page.getByRole('button', { name: /^Select .*Bed/ });
  await expect(object).toHaveCount(1);
  await object.click();
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill('R02 North bed');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();

  await page.reload();
  await waitForRouteContent(page, '/map');
  await page.getByRole('tab', { name: 'Objects', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Select R02 North bed, Bed', exact: true }),
  ).toBeVisible();
});

test('plant, observation, and manual task remain available after reloading', async ({ page }) => {
  const garden = await createPopulatedGarden(page, 'records');
  const base = `/application/gardens/${garden.gardenId}`;

  await page.goto(`${base}/plants`);
  await expect(page.getByRole('link', { name: garden.plantName, exact: true })).toBeVisible();
  await page.getByRole('link', { name: garden.plantName, exact: true }).click();
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
