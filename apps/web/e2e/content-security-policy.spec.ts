import { expect, test, type Page } from '@playwright/test';

import {
  auditedRoutes,
  createPopulatedGarden,
  signIn,
  waitForRouteContent,
  type SignedInGarden,
} from './support/signed-in-garden';

/**
 * Does the Content Security Policy actually work, in a real browser, with
 * enforcement ON?
 *
 * WHY THIS SPEC EXISTS
 *
 * threat-model.md section 16.4 recorded that enforcing the previous policy
 * "would break sign-in and media upload", and that nothing was collecting
 * violations anywhere but a browser console. The first half of `P8-SEC-02` is
 * a corrected policy; this file is the evidence that the correction is real,
 * because a policy nobody has enforced against a real browser is a policy
 * nobody knows the shape of.
 *
 * HOW ENFORCEMENT IS TURNED ON FOR THIS SUITE
 *
 * `e2e/run-e2e.sh` sets `WEB_CSP_MODE=enforce`, so the whole harness — this
 * spec AND every sibling spec — runs against an enforcing policy. That is
 * deliberate and it is where most of the evidence actually comes from: the
 * sign-in flow, the map, the keyboard suite, and the responsive suite all
 * exercise real product behavior, and under enforcement a missing directive
 * does not produce a warning, it produces a broken test.
 *
 * WHAT THIS SPEC ADDS ON TOP OF THAT
 *
 * A sibling spec breaking tells you SOMETHING is wrong. This one tells you
 * what: it listens for `securitypolicyviolation` on every route and reports
 * the exact directive and blocked URI, so the failure names the missing
 * source rather than surfacing as "the map did not render".
 *
 * THE ONE GAP, STATED HONESTLY
 *
 * The harness runs `next dev`, whose React Refresh runtime needs
 * `'unsafe-eval'` and whose hot reload needs a `ws:` connection. The policy
 * adds both, and only, in development. So what is proven here is: the
 * production policy PLUS those two sources is sufficient for every route. The
 * `differs from production only by...` test below pins that delta exactly, so
 * the gap cannot silently widen into something else.
 *
 * Source: docs/development/threat-model.md, section 16.4;
 * docs/development/security-enforcement-readiness.md; work package `P8-SEC-02`.
 */

interface RecordedViolation {
  readonly directive: string;
  readonly blockedURI: string;
  readonly disposition: string;
}

declare global {
  interface Window {
    __cspViolations?: RecordedViolation[];
  }
}

/**
 * Starts recording before any page script runs.
 *
 * `addInitScript` is evaluated ahead of the document's own scripts, so a
 * violation caused by the very first inline bootstrap is still caught. It is
 * injected through the debugging protocol rather than as a page script, so
 * the CSP under test does not block the listener that measures it.
 */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push({
        directive: event.violatedDirective,
        blockedURI: event.blockedURI,
        disposition: event.disposition,
      });
    });
  });
}

async function violationsOn(page: Page): Promise<RecordedViolation[]> {
  return await page.evaluate(() => window.__cspViolations ?? []);
}

function describeViolations(violations: readonly RecordedViolation[]): string {
  return violations
    .map((v) => `  ${v.directive} blocked ${v.blockedURI} (disposition: ${v.disposition})`)
    .join('\n');
}

/** Reads the served policy, whichever header name it arrived under. */
async function servedPolicy(page: Page, path: string): Promise<{ header: string; value: string }> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  const headers = response.headers();
  const enforcing = headers['content-security-policy'];
  const reportOnly = headers['content-security-policy-report-only'];

  if (enforcing !== undefined) {
    return { header: 'content-security-policy', value: enforcing };
  }
  expect(reportOnly, `no CSP header of either kind on ${path}`).toBeDefined();
  return { header: 'content-security-policy-report-only', value: reportOnly as string };
}

function directiveOf(policy: string, name: string): string {
  const found = policy.split('; ').find((e) => e === name || e.startsWith(`${name} `));
  expect(found, `policy has no "${name}" directive`).toBeDefined();
  return found as string;
}

test.describe.serial('content security policy', () => {
  let garden: SignedInGarden;

  test('set up an account whose every route has real content on it', async ({ page }) => {
    garden = await createPopulatedGarden(page, 'csp');
  });

  test('the harness really is running the ENFORCING policy', async ({ page }) => {
    // If this fails, every "zero violations" assertion below is worthless —
    // a report-only policy blocks nothing, so of course nothing breaks. This
    // is the test that makes the rest of the file mean something.
    const { header } = await servedPolicy(page, '/auth/sign-in');

    expect(header, 'run-e2e.sh must set WEB_CSP_MODE=enforce, or this suite proves nothing').toBe(
      'content-security-policy',
    );
  });

  test('the policy carries a nonce and no unsafe-inline for scripts', async ({ page }) => {
    const { value } = await servedPolicy(page, '/auth/sign-in');
    const scriptSrc = directiveOf(value, 'script-src');

    // The whole reason a nonce was introduced: with 'unsafe-inline' an
    // enforced policy would not stop the injected inline script it exists to
    // stop.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/u);
  });

  test('the nonce is different on every response', async ({ page }) => {
    const first = await servedPolicy(page, '/auth/sign-in');
    const second = await servedPolicy(page, '/auth/sign-in');

    const nonceOf = (policy: string) => /'nonce-([A-Za-z0-9+/=]+)'/u.exec(policy)?.[1];

    expect(nonceOf(first.value)).toBeDefined();
    expect(nonceOf(first.value)).not.toBe(nonceOf(second.value));
  });

  test('every Next.js inline script carries that nonce', async ({ page }) => {
    // The mechanism the whole policy rests on. If Next.js ever stops reading
    // the nonce out of the request header, enforcement would blank the app —
    // and this test is what catches that before an operator does.
    const response = await page.request.get('/auth/sign-in');
    const html = await response.text();

    const scriptTags = html.match(/<script\b[^>]*>/gu) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);

    const unnonced = scriptTags.filter((tag) => !tag.includes('nonce='));
    expect(unnonced, `script tags without a nonce:\n${unnonced.join('\n')}`).toHaveLength(0);
  });

  test('the policy declares somewhere for violations to go', async ({ page }) => {
    // threat-model.md 16.4's first finding: the previous policy declared
    // neither, so a violation reached a browser console and nothing else.
    const { value } = await servedPolicy(page, '/auth/sign-in');

    expect(value).toContain('report-uri /internal/csp-report');
    expect(value).toContain('report-to csp');
  });

  test('the reporting endpoint accepts a real report and answers 204', async ({ page }) => {
    const response = await page.request.post('/internal/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: {
        'csp-report': {
          'document-uri': 'http://localhost/auth/sign-in',
          'violated-directive': 'script-src',
          'blocked-uri': 'https://example.test/x.js',
          disposition: 'enforce',
        },
      },
    });

    expect(response.status()).toBe(204);
  });

  test('it differs from the production policy only by the two next dev sources', async ({
    page,
  }) => {
    // The honest statement of this suite's one gap, written as an assertion
    // so it cannot widen unnoticed. Everything below is what `next dev`
    // needs and a production build does not.
    const { value } = await servedPolicy(page, '/auth/sign-in');

    expect(directiveOf(value, 'script-src')).toContain("'unsafe-eval'");
    expect(directiveOf(value, 'connect-src')).toContain('ws:');

    // And nothing else is loosened: no wildcard host, no data: or blob: in
    // script-src, no 'unsafe-inline' anywhere but style-src.
    expect(value).not.toContain('*');
    expect(directiveOf(value, 'script-src')).not.toContain('blob:');
    expect(directiveOf(value, 'script-src')).not.toContain('data:');
    expect(directiveOf(value, 'default-src')).toBe("default-src 'self'");
    expect(directiveOf(value, 'object-src')).toBe("object-src 'none'");
    expect(directiveOf(value, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  test('no route reports a single violation under enforcement', async ({ page }) => {
    await recordViolations(page);
    // Every Playwright test gets a fresh browser context, so the session the
    // setup test established is not this test's session. The sibling audit
    // suites (accessibility, responsive, keyboard) re-sign-in for the same
    // reason; without it every authenticated route silently redirects to
    // sign-in and this suite would report zero violations on nine copies of
    // the same page.
    await signIn(page, garden.email);

    const failures: string[] = [];

    for (const route of auditedRoutes(garden.gardenId)) {
      await page.goto(route.path);
      await waitForRouteContent(page, route.path);

      const violations = await violationsOn(page);
      if (violations.length > 0) {
        failures.push(`${route.name} (${route.path}):\n${describeViolations(violations)}`);
      }
    }

    expect(
      failures,
      `The enforcing policy blocked something on ${String(failures.length)} route(s):\n${failures.join('\n')}`,
    ).toEqual([]);
  });

  test('the map renders under enforcement, which needs worker-src blob:', async ({ page }) => {
    // MapLibre builds its worker from a Blob URL. Without `worker-src blob:`
    // this is the route that dies first and most silently, so it gets its own
    // named test rather than hiding inside the loop above.
    await recordViolations(page);
    await signIn(page, garden.email);

    await page.goto(`/application/gardens/${garden.gardenId}/map`);
    await waitForRouteContent(page, `/application/gardens/${garden.gardenId}/map`);

    const workerViolations = (await violationsOn(page)).filter(
      (v) => v.directive.includes('worker-src') || v.directive.includes('child-src'),
    );

    expect(workerViolations, describeViolations(workerViolations)).toEqual([]);
    await expect(page.getByRole('application')).toBeVisible();
  });

  test('signing in works under enforcement, end to end', async ({ page }) => {
    // The specific claim threat-model.md 16.4 made about the OLD policy —
    // "enforcing today's policy as written would break sign-in" — retested
    // against the new one, with the policy actually enforced. Firebase Auth
    // needs identitytoolkit and securetoken in connect-src and the auth
    // domain in frame-src; App Check needs reCAPTCHA in script-src.
    await recordViolations(page);

    const populated = await createPopulatedGarden(page, 'csp-signin');

    expect(populated.gardenId).not.toBe('');
    const violations = await violationsOn(page);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});
