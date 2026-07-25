import { expect, test, type Page } from '@playwright/test';

import { createPopulatedGarden, signIn, waitForRouteContent } from './support/signed-in-garden';

/**
 * `prefers-reduced-motion: reduce` really does suppress every animation and
 * transition the token system introduced.
 *
 * The global rule in `shared/ui/global.css` is written as a wildcard, so the
 * risk is not that it misses a selector — it is that some element animates
 * through a property the rule does not reset (a `transition-delay`, or an
 * `animation-delay` on a spinner), or that a future stylesheet lands with
 * `!important` of its own. Reading the *computed* durations off the rendered
 * elements is the only check that catches either.
 *
 * The elements sampled are every animated surface the visual pass added: the
 * button's hover/press transition and its busy spinner, the loading-status
 * pulse dot, the navigation tab's colour transition, the text field's border
 * transition, and the list rows' hover transition.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility"
 * ("Motion and animation respect user preferences"); work package P8-UX-01.
 */

interface Timing {
  readonly selector: string;
  readonly transitionDuration: string;
  readonly transitionDelay: string;
  readonly animationDuration: string;
  readonly animationDelay: string;
  readonly count: number;
}

/** Longest duration, in milliseconds, out of a computed CSS time list. */
function longestMilliseconds(value: string): number {
  return Math.max(
    ...value.split(',').map((part) => {
      const trimmed = part.trim();
      if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
      if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
      return 0;
    }),
  );
}

async function measure(page: Page, selectors: readonly string[]): Promise<readonly Timing[]> {
  return page.evaluate((list) => {
    return list.map((selector) => {
      const elements = document.querySelectorAll(selector);
      const first = elements[0];
      if (first === undefined) {
        return {
          selector,
          transitionDuration: '0s',
          transitionDelay: '0s',
          animationDuration: '0s',
          animationDelay: '0s',
          count: 0,
        };
      }
      const style = getComputedStyle(first);
      return {
        selector,
        transitionDuration: style.transitionDuration,
        transitionDelay: style.transitionDelay,
        animationDuration: style.animationDuration,
        animationDelay: style.animationDelay,
        count: elements.length,
      };
    });
  }, selectors);
}

/** Every element the design system animates, by a selector that survives CSS-module hashing. */
const ANIMATED = [
  'button',
  'input[type="text"], input[type="email"], input:not([type])',
  'select',
  'nav a',
  'li',
] as const;

test.describe.serial('reduced motion', () => {
  let email = '';
  let gardenId = '';

  test('set up an account whose pages hold animated elements', async ({ page }) => {
    const garden = await createPopulatedGarden(page, 'motion');
    email = garden.email;
    gardenId = garden.gardenId;
  });

  test('the default preference leaves the design system animated', async ({ page }) => {
    // The negative control. Without it, a stylesheet that lost every
    // transition entirely would pass the suppression test below for the
    // wrong reason.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await signIn(page, email);
    await page.goto(`/application/gardens/${gardenId}/tasks`);
    await waitForRouteContent(page, '/tasks');

    const timings = await measure(page, ANIMATED);
    const animatedCount = timings.filter(
      (timing) => timing.count > 0 && longestMilliseconds(timing.transitionDuration) > 10,
    ).length;

    expect(animatedCount, JSON.stringify(timings, null, 2)).toBeGreaterThan(0);
  });

  test('reduce suppresses every transition and animation on every route', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, email);

    for (const path of [
      '/application/gardens',
      `/application/gardens/${gardenId}`,
      `/application/gardens/${gardenId}/today`,
      `/application/gardens/${gardenId}/tasks`,
      `/application/gardens/${gardenId}/plants`,
      `/application/gardens/${gardenId}/observations`,
      `/application/gardens/${gardenId}/map`,
    ]) {
      await page.goto(path);
      await waitForRouteContent(page, path);

      const timings = await measure(page, ANIMATED);

      for (const timing of timings) {
        if (timing.count === 0) {
          continue;
        }
        const context = `${path} ${timing.selector}: ${JSON.stringify(timing)}`;
        expect(longestMilliseconds(timing.transitionDuration), context).toBeLessThanOrEqual(1);
        expect(longestMilliseconds(timing.transitionDelay), context).toBeLessThanOrEqual(0);
        expect(longestMilliseconds(timing.animationDuration), context).toBeLessThanOrEqual(1);
        expect(longestMilliseconds(timing.animationDelay), context).toBeLessThanOrEqual(0);
      }
    }
  });

  test('the busy spinner and the loading pulse stop under reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, email);
    await page.goto(`/application/gardens/${gardenId}/today`);

    // Both of these are `animation: ... infinite` at rest: the button's
    // `::after` ring and the `p[role="status"]::before` dot. A pseudo-element
    // needs its own computed-style read.
    const pseudo = await page.evaluate(() => {
      const button = document.querySelector('button');
      const status = document.querySelector('p[role="status"]');
      const read = (element: Element | null, selector: string) => {
        if (element === null) return null;
        const style = getComputedStyle(element, selector);
        return {
          animationDuration: style.animationDuration,
          animationIterationCount: style.animationIterationCount,
        };
      };
      return { button: read(button, '::after'), status: read(status, '::before') };
    });

    for (const [name, values] of Object.entries(pseudo)) {
      if (values === null) {
        continue;
      }
      expect(longestMilliseconds(values.animationDuration), name).toBeLessThanOrEqual(1);
      expect(Number(values.animationIterationCount), name).toBeLessThanOrEqual(1);
    }
  });
});
