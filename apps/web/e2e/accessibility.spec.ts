import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { copy } from './support/copy';
import {
  auditedRoutes,
  createPopulatedGarden,
  signIn,
  waitForRouteContent,
  type SignedInGarden,
} from './support/signed-in-garden';

/**
 * Automated WCAG audit of every route this harness can reach, in both themes.
 *
 * WHY `@axe-core/playwright` AND NOT `axe-core` UNDER VITEST/JSDOM
 *
 * The single most valuable check here is colour contrast, and jsdom computes
 * no layout and resolves no cascade — `getComputedStyle` there returns the
 * inline value, not the value a browser would paint, so axe's `color-contrast`
 * rule disables itself entirely under jsdom. The same is true of every rule
 * that depends on an element's rendered box: target size, focus visibility,
 * and whether an element is actually visible at all. Running axe in the real
 * Chromium the E2E suite already starts is therefore not a convenience, it is
 * the only place these rules can produce a real answer. The dependency is
 * `devDependencies` only and ships nothing to users.
 *
 * The token-level contrast arithmetic that axe cannot see — SC 1.4.11
 * (Non-text Contrast), for which axe implements no rule — is asserted
 * separately and exhaustively in `shared/ui/contrast.test.ts`.
 *
 * WHY BOTH THEMES
 *
 * `tokens.css` defines the dark palette behind `prefers-color-scheme: dark`.
 * A run in the default light theme never evaluates a single dark colour, so
 * half the design system would go unaudited. `page.emulateMedia` flips the
 * real media query rather than forcing an attribute, so what is audited is
 * what a reader with that OS preference actually gets.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility";
 * technical-specification.md, section 11 ("Accessibility requirements must be
 * defined and tested before release"); work package P8-UX-01.
 */

/**
 * The WCAG levels this product commits to.
 *
 * `best-practice` is included deliberately alongside the normative tags: it
 * is where axe puts landmark structure, heading order, and the "page has one
 * main and one h1" checks — the structural rules a screen-reader user
 * navigates by, all of which this suite has found real defects in.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

function analyzer(page: Page) {
  return (
    new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      /*
       * The Konva stage is a `<canvas>` inside `role="application"`. axe's
       * colour-contrast rule cannot read pixels out of a canvas, and its
       * `nested-interactive` rule has no way to know that the stage's
       * children are drawn, not DOM. The canvas's own accessible story —
       * label, keyboard description, and the structured object list that is
       * its non-canvas equivalent — is asserted directly in
       * `keyboard.spec.ts` instead, which is the honest place for it.
       */
      .exclude('canvas')
  );
}

interface Violation {
  readonly id: string;
  readonly impact?: string | null | undefined;
  readonly nodes: readonly { readonly html: string; readonly failureSummary?: string }[];
}

/** A readable failure message: axe's own JSON is unreadable in a CI log. */
function describe(violations: readonly Violation[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 4)
        .map((node) => `      ${node.html}\n      ${node.failureSummary ?? ''}`)
        .join('\n');
      return `  ${violation.id} (${violation.impact ?? 'unknown'}), ${String(violation.nodes.length)} node(s):\n${nodes}`;
    })
    .join('\n');
}

async function expectNoViolations(page: Page, context: string): Promise<void> {
  const results = await analyzer(page).analyze();
  const violations = results.violations as unknown as readonly Violation[];

  expect(violations.length, `${context}\n${describe(violations)}`).toBe(0);
}

test.describe.serial('accessibility audit', () => {
  let garden: SignedInGarden;

  test('set up an account whose every route has real content on it', async ({ page }) => {
    garden = await createPopulatedGarden(page, 'a11y');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`every reachable route has zero axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page, garden.email);

      for (const route of auditedRoutes(garden.gardenId)) {
        await page.goto(route.path);
        await waitForRouteContent(page, route.path);
        await expectNoViolations(page, `${route.name} (${route.path}), ${theme} theme`);
      }
    });
  }

  test('expanded panels and open forms are audited too, not just the collapsed page', async ({
    page,
  }) => {
    await signIn(page, garden.email);

    // A disclosure that is closed at load time is never audited by the pass
    // above — its markup does not exist yet. Today's evidence panel and a
    // task's edit form are both only reachable by opening them.
    await page.goto(`/application/gardens/${garden.gardenId}/today`);
    await waitForRouteContent(page, '/today');
    // Selected by `aria-expanded="false"` rather than by name, and clicked
    // one at a time: opening a panel renames its own trigger ("Show…" becomes
    // "Hide…") and, for Postpone, adds a second button of the same name
    // inside the panel. The disclosure state is the only stable, terminating
    // predicate for "still closed".
    const openEvery = async (name: string) => {
      for (let guard = 0; guard < 10; guard += 1) {
        const closed = page
          .getByRole('button', { name, exact: true })
          .and(page.locator('[aria-expanded="false"]'));
        if ((await closed.count()) === 0) {
          return;
        }
        await closed.first().click();
      }
    };

    await openEvery(copy.todayDetailsShow);
    await openEvery(copy.todayPostpone);
    await expectNoViolations(page, 'today with every panel expanded');

    await page.goto(`/application/gardens/${garden.gardenId}/tasks`);
    await waitForRouteContent(page, '/tasks');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.getByRole('button', { name: 'Reschedule' }).first().click();
    await expectNoViolations(page, 'tasks with the edit and reschedule panels open');
  });

  test('a form error is announced and associated, not shown in colour alone', async ({ page }) => {
    await page.goto('/auth/sign-in');

    await page.getByLabel(copy.emailLabel).fill('not-an-email');
    await page.getByRole('button', { name: copy.emailSubmit }).click();

    const field = page.getByLabel(copy.emailLabel);
    await expect(field).toHaveAttribute('aria-invalid', 'true');

    // The message the field points at must exist, carry text, and be a live
    // region — an `aria-describedby` aimed at nothing is worse than none.
    const describedBy = await field.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const message = page.locator(`#${describedBy ?? ''}`);
    await expect(message).toHaveAttribute('role', 'alert');
    await expect(message).not.toBeEmpty();

    await expectNoViolations(page, 'sign-in with a field error showing');
  });

  test('the garden tabs mark the current page for assistive technology', async ({ page }) => {
    await signIn(page, garden.email);

    for (const route of [
      { path: `/application/gardens/${garden.gardenId}/today`, tab: copy.todayNavLink },
      { path: `/application/gardens/${garden.gardenId}/tasks`, tab: 'Tasks' },
    ]) {
      await page.goto(route.path);
      const current = page
        .getByRole('link', { name: route.tab })
        .and(page.locator('[aria-current]'));
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('aria-current', 'page');

      // Exactly one tab claims to be the current page.
      await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('every page has exactly one main landmark, one h1, and no skipped heading level', async ({
    page,
  }) => {
    await signIn(page, garden.email);

    for (const route of auditedRoutes(garden.gardenId)) {
      await page.goto(route.path);
      await waitForRouteContent(page, route.path);

      await expect(page.getByRole('main'), route.name).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 }), route.name).toHaveCount(1);

      const levels = await page
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((elements) => elements.map((element) => Number(element.tagName.slice(1))));

      levels.forEach((level, index) => {
        const previous = index === 0 ? level : (levels[index - 1] ?? level);
        expect(
          level - previous,
          `${route.name}: heading levels ${JSON.stringify(levels)} skip a level`,
        ).toBeLessThanOrEqual(1);
      });
    }
  });
});
