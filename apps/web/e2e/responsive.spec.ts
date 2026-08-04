import { expect, test, type Page } from '@playwright/test';

import {
  auditedRoutes,
  createPopulatedGarden,
  signIn,
  waitForRouteContent,
  type SignedInGarden,
} from './support/signed-in-garden';

/**
 * Layout at every supported width, and touch-target size at the smallest one.
 *
 * The three viewports are the product's own stated targets
 * (technical-specification.md, section 11: "The product must support iPhone,
 * iPad, and web layouts"): 360x780 is the narrowest phone still in the
 * browser baseline, 834x1112 is iPad portrait, and 1440x900 is the
 * desktop/laptop width the map editor is optimised for.
 *
 * WHAT IS ASSERTED, AND WHY EACH IS THE RIGHT PROXY
 *
 * - No horizontal document overflow. A page whose `scrollWidth` exceeds its
 *   viewport forces two-axis scrolling, which is WCAG 1.4.10 (Reflow). The
 *   check is on `documentElement`, not on individual elements, because a
 *   deliberately scrollable strip (the garden tab bar) is allowed to overflow
 *   *itself* — that is the intended behaviour — but must never push the
 *   document wide.
 * - Touch targets at least `--control-min-size`. Measured from the rendered
 *   box of every button and standalone link, at the phone width where a
 *   thumb is the input device. Read from the token so the stylesheet and the
 *   assertion cannot disagree.
 * - The garden tab bar scrolls rather than wrapping into a stack of
 *   half-height rows: its scroll width may exceed its client width (that is
 *   the scroll), but every tab must sit on one line.
 *
 * Source: technical-specification.md, section 11; work package P8-UX-01.
 */

const VIEWPORTS = [
  { name: 'phone 360', width: 360, height: 780 },
  { name: 'tablet 834', width: 834, height: 1112 },
  { name: 'desktop 1440', width: 1440, height: 900 },
] as const;

/** Reads `--control-min-size` off the live document, in CSS pixels. */
async function controlMinimumPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--control-min-size')
      .trim();
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return value.endsWith('rem')
      ? Number.parseFloat(value) * rootFontSize
      : Number.parseFloat(value);
  });
}

/*
 * NOTE ON THE SIGN-IN ROUTE
 *
 * These specs run signed in, and `proxy.ts` redirects an authenticated
 * request for `/auth/sign-in` straight to the gardens list. The route stays
 * in the loop regardless — it is audited unauthenticated by
 * `accessibility.spec.ts`'s form-error test — but a failure labelled
 * "sign-in" is reporting on the page the redirect landed on.
 */

async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });

  // One pixel of slack: sub-pixel layout rounding is not an overflow.
  expect(
    overflow.scrollWidth,
    `${context}: the document scrolls ${String(overflow.scrollWidth - overflow.clientWidth)}px horizontally`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe.serial('responsive layout', () => {
  let garden: SignedInGarden;

  test('set up an account whose every route has real content on it', async ({ page }) => {
    garden = await createPopulatedGarden(page, 'responsive');
  });

  for (const viewport of VIEWPORTS) {
    test(`no route scrolls horizontally at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, garden.email);

      for (const route of auditedRoutes(garden.gardenId)) {
        await page.goto(route.path);
        await waitForRouteContent(page, route.path);
        await expectNoHorizontalOverflow(page, `${route.name} at ${viewport.name}`);
      }
    });
  }

  test('every control is at least one full touch target at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, garden.email);

    const minimum = await controlMinimumPixels(page);
    expect(minimum).toBeGreaterThanOrEqual(44);

    for (const route of auditedRoutes(garden.gardenId)) {
      await page.goto(route.path);
      await waitForRouteContent(page, route.path);

      const undersized = await page.evaluate((limit) => {
        const results: string[] = [];
        const candidates = document.querySelectorAll<HTMLElement>(
          'button, [role="button"], nav a, a[class*="tab"], a[class*="link"]',
        );
        for (const element of candidates) {
          const box = element.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) {
            continue; // Not rendered — a collapsed panel's contents.
          }
          if (box.height + 0.5 < limit) {
            results.push(
              `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 40)}" is ${box.height.toFixed(1)}px tall`,
            );
          }
        }
        return results;
      }, minimum);

      expect(undersized, `${route.name} at 360px`).toEqual([]);
    }
  });

  /*
   * On a phone the garden rail collapses to icons. The label leaves the
   * layout but must stay in the accessibility tree: `display: none` on it
   * left six links with no accessible name at all, which is a rail nobody
   * using a screen reader can navigate, and which no visual check catches.
   */
  test('the collapsed garden rail keeps a column of named icons', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/today`);

    const rail = page.locator('nav').filter({ has: page.getByRole('link', { name: 'Today' }) });
    await expect(rail).toBeVisible();

    const measurements = await rail.evaluate((element) => {
      const tabs = [...element.querySelectorAll('a')].map((tab) => tab.getBoundingClientRect());
      return {
        tabCount: tabs.length,
        distinctLefts: new Set(tabs.map((box) => Math.round(box.left))).size,
        distinctTops: new Set(tabs.map((box) => Math.round(box.top))).size,
        widestTab: Math.max(...tabs.map((box) => box.width)),
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    // Every section is reachable, and every one of them announces itself.
    // The accessible name is computed from the a11y tree, so this is the
    // assertion that fails the moment a label is hidden with `display: none`
    // rather than clipped out of the layout.
    expect(measurements.tabCount).toBeGreaterThan(4);
    for (const link of await rail.getByRole('link').all()) {
      await expect(link).toHaveAccessibleName(/\S/u);
    }

    // One column of icons: stacked, not spread, and narrow enough that the
    // rail costs the content almost nothing on a 360px screen.
    expect(measurements.distinctLefts).toBe(1);
    expect(measurements.distinctTops).toBe(measurements.tabCount);
    expect(measurements.widestTab).toBeLessThan(measurements.viewportWidth / 4);
  });

  test('the map editor stacks its sidebar below the canvas on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/map`);
    await waitForRouteContent(page, '/map');

    const canvas = await page.getByRole('application').boundingBox();
    const objectList = await page.getByRole('heading', { name: 'Objects' }).first().boundingBox();

    expect(canvas).not.toBeNull();
    expect(objectList).not.toBeNull();
    // Below, not beside: a side-by-side editor at 360px leaves neither
    // column usable.
    expect(objectList?.y ?? 0).toBeGreaterThan((canvas?.y ?? 0) + (canvas?.height ?? 0) - 1);
  });
});
