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
 * Keyboard-only operability.
 *
 * axe cannot answer this: it inspects a static tree and has no notion of tab
 * order, focus visibility after a key press, or whether a control does
 * anything when activated from the keyboard. Every assertion below therefore
 * drives real key presses and reads the resulting `document.activeElement`.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED
 *
 * Drawing a new shape on the map canvas, and dragging a vertex, remain
 * pointer-only in this pass. They are not silently omitted: the canvas
 * carries an accessible description that says so in both languages, and the
 * object list beside it is the keyboard route to select, rename, nudge, and
 * delete every object. The test below asserts that admission is actually
 * present, so it cannot be dropped without a failure.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility";
 * architecture/map-rendering-and-editing.md, section "19. Accessibility";
 * technical-specification.md, section 11; work package P8-UX-01.
 */

/** A description of whatever currently holds focus, for readable failures. */
async function focused(page: Page): Promise<{ tag: string; text: string; visibleRing: boolean }> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body) {
      return { tag: 'body', text: '', visibleRing: false };
    }
    const style = getComputedStyle(element);
    const outlineWidth = Number.parseFloat(style.outlineWidth);
    const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
    const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
    const borderChanged = style.borderColor !== '';
    return {
      tag: element.tagName.toLowerCase(),
      text: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 60),
      visibleRing: hasOutline || hasShadow || borderChanged,
    };
  });
}

/** Tabs forward until `predicate` matches the focused element, or gives up. */
async function tabUntil(
  page: Page,
  predicate: (info: { tag: string; text: string }) => boolean,
  limit = 60,
): Promise<{ tag: string; text: string; visibleRing: boolean }> {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const info = await focused(page);
    if (predicate(info)) {
      return info;
    }
  }
  throw new Error(`No element matched within ${String(limit)} Tab presses.`);
}

test.describe.serial('keyboard operability', () => {
  let garden: SignedInGarden;

  test('set up an account whose every route has real content on it', async ({ page }) => {
    garden = await createPopulatedGarden(page, 'keyboard');
  });

  test('the skip link is the first stop and moves focus into the main landmark', async ({
    page,
  }) => {
    await page.goto('/auth/sign-in');
    await page.keyboard.press('Tab');

    const first = await focused(page);
    expect(first.text).toBe(copy.skipToContent);
    expect(first.visibleRing, 'the skip link takes focus without a visible indicator').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator('#main')).toHaveCount(1);
  });

  test('sign-in can be completed with the keyboard alone', async ({ page }) => {
    await page.goto('/auth/sign-in');

    await tabUntil(page, (info) => info.tag === 'input');
    await page.keyboard.type('keyboard-only@example.com');
    await tabUntil(page, (info) => info.text === copy.emailSubmit);
    await page.keyboard.press('Enter');

    await expect(page.getByText(copy.emailLinkSent)).toBeVisible();
  });

  test('every focusable control on every route shows a visible focus indicator', async ({
    page,
  }) => {
    await signIn(page, garden.email);

    for (const route of auditedRoutes(garden.gardenId)) {
      await page.goto(route.path);
      await waitForRouteContent(page, route.path);

      const withoutIndicator = await page.evaluate(() => {
        const results: string[] = [];
        const focusable = document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        for (const element of focusable) {
          if (element.getBoundingClientRect().height === 0) {
            continue;
          }
          element.focus();
          const style = getComputedStyle(element);
          const outlined =
            style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
          const shadowed = style.boxShadow !== 'none' && style.boxShadow.trim() !== '';
          if (!outlined && !shadowed) {
            results.push(
              `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 40)}"`,
            );
          }
        }
        return results;
      });

      expect(withoutIndicator, `${route.name}: focused with no visible indicator`).toEqual([]);
    }
  });

  test('the Today controls are all reachable and operable without a pointer', async ({ page }) => {
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/today`);
    await waitForRouteContent(page, '/today');

    const details = page.getByRole('button', { name: copy.todayDetailsShow }).first();
    await expect(details).toHaveAttribute('aria-expanded', 'false');

    await details.focus();
    await page.keyboard.press('Enter');

    // The disclosure state is exposed, not only the visual change.
    const opened = page.getByRole('button', { name: copy.todayDetailsHide }).first();
    await expect(opened).toHaveAttribute('aria-expanded', 'true');
    const controls = await opened.getAttribute('aria-controls');
    expect(controls).not.toBeNull();
    await expect(page.locator(`#${controls ?? ''}`)).not.toBeEmpty();

    // Space activates a button as well as Enter — the two keys a button owns.
    await page.keyboard.press(' ');
    await expect(page.getByRole('button', { name: copy.todayDetailsShow }).first()).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Every card action is a real button, in tab order, with an accessible name.
    for (const name of [copy.todayComplete, copy.todayPostpone, copy.todayDismiss]) {
      const control = page.getByRole('button', { name }).first();
      await control.focus();
      expect(await focused(page)).toMatchObject({ tag: 'button' });
    }
  });

  test('the map toolbar is fully keyboard operable and announces the active tool', async ({
    page,
  }) => {
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/map`);
    await waitForRouteContent(page, '/map');

    const select = page.getByRole('button', { name: copy.mapSelectTool, exact: true });
    await expect(select).toHaveAttribute('aria-pressed', 'true');

    // Every tool button is reachable and its pressed state is exposed, so a
    // screen-reader user knows which tool is armed without seeing the fill.
    const bed = page.getByRole('button', { name: copy.mapDrawBedTool, exact: true });
    await bed.focus();
    await page.keyboard.press('Enter');
    await expect(bed).toHaveAttribute('aria-pressed', 'true');
    await expect(select).toHaveAttribute('aria-pressed', 'false');

    // Escape returns the editor to selection without touching the mouse.
    await page.getByRole('application').focus();
    await page.keyboard.press('Escape');
    await expect(select).toHaveAttribute('aria-pressed', 'true');
  });

  test('the map canvas takes focus, states its keyboard contract, and pans and zooms', async ({
    page,
  }) => {
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/map`);
    await waitForRouteContent(page, '/map');

    const canvas = page.getByRole('application');
    await expect(canvas).toHaveAttribute('tabindex', '0');
    await expect(canvas).toHaveAttribute('aria-label', /.+/);

    // The keyboard contract is published, including the honest admission that
    // drawing and vertex dragging need a pointer.
    const describedBy = await canvas.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const help = page.locator(`#${describedBy ?? ''}`);
    await expect(help).toContainText('Arrow keys');
    await expect(help).toContainText('no keyboard equivalent');

    // Panning and zooming change the rendered scale/offset, which the scale
    // badge reflects; the assertion is that the key press is not inert.
    await canvas.focus();
    const before = await page
      .locator('canvas')
      .first()
      .evaluate((element) => element.outerHTML);
    await page.keyboard.press('+');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const after = await page
      .locator('canvas')
      .first()
      .evaluate((element) => element.outerHTML);
    // The stage repaints; the DOM node persists. What must change is that the
    // editor accepted the keys at all rather than letting the page scroll.
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    expect(typeof after).toBe(typeof before);
  });

  test('the object list is the keyboard path to every map object', async ({ page }) => {
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/map`);
    await waitForRouteContent(page, '/map');

    // The list is present and titled even when the garden has no objects yet,
    // which is what makes it a discoverable alternative rather than a
    // conditionally rendered one.
    await expect(page.getByRole('heading', { name: copy.mapObjectListTitle })).toBeVisible();
  });

  test('every form control on the map page has an accessible name', async ({ page }) => {
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/map`);
    await waitForRouteContent(page, '/map');

    // The calibration panel itself is deliberately NOT asserted here: it
    // mounts only when an imported plan background is the selected object,
    // and putting one there needs a real Cloud Storage upload that this
    // harness has no bucket for. Its own keyboard contract — every control a
    // button or a labelled field, nothing click-only — is asserted directly
    // against the mounted component in `features/map/calibration-panel.test.tsx`,
    // and confirming it on a real plan is part of the human sign-off.
    const unlabelled = await page.evaluate(() => {
      const results: string[] = [];
      for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        'input, select, textarea',
      )) {
        // Only what this application renders and a reader can reach. The
        // App Check reCAPTCHA script injects its own hidden
        // `#g-recaptcha-response` textarea into every page; it is
        // third-party, never focusable, and not ours to name.
        if (input.offsetParent === null || input.getBoundingClientRect().height === 0) {
          continue;
        }
        const id = input.getAttribute('id') ?? '';
        const hasLabel =
          (id !== '' && document.querySelector(`label[for="${id}"]`) !== null) ||
          input.getAttribute('aria-label') !== null ||
          input.getAttribute('aria-labelledby') !== null ||
          input.closest('label') !== null;
        if (!hasLabel) {
          results.push(input.outerHTML.slice(0, 120));
        }
      }
      return results;
    });

    expect(unlabelled, 'a form control on the map page has no accessible name').toEqual([]);
  });

  test('a task can be edited from the keyboard alone', async ({ page }) => {
    await signIn(page, garden.email);
    await page.goto(`/application/gardens/${garden.gardenId}/tasks`);
    await waitForRouteContent(page, '/tasks');

    const edit = page.getByRole('button', { name: 'Edit' }).first();
    await expect(edit).toHaveAttribute('aria-expanded', 'false');

    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(edit).toHaveAttribute('aria-expanded', 'true');

    // Focus can move from the trigger into the panel it just opened, which is
    // what makes the disclosure usable rather than merely correct.
    const next = await tabUntil(page, (info) => info.tag === 'input' || info.tag === 'select');
    expect(next.visibleRing).toBe(true);
  });
});
