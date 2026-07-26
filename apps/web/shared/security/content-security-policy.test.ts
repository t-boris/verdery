/**
 * The policy, pinned.
 *
 * These tests exist because of what threat-model.md section 16.4 recorded:
 * the previous policy would have broken sign-in and media upload if enforced,
 * and nobody would have found out until it was enforced. Each assertion below
 * names the runtime behavior it protects, so a future edit that drops an
 * origin fails with a message that says which feature just died rather than
 * with a string diff.
 *
 * What these tests CANNOT prove is that the list is complete — only a real
 * browser can prove an absence. That is `e2e/content-security-policy.spec.ts`,
 * which loads every route under this exact policy in ENFORCING mode and fails
 * on any violation. The two halves are deliberate: this file says "the policy
 * says what we meant", the E2E says "what we meant is enough".
 */

import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  CSP_ENFORCE_HEADER,
  CSP_ORIGINS,
  CSP_REPORT_GROUP,
  CSP_REPORT_ONLY_HEADER,
  CSP_REPORT_PATH,
  cspHeaderName,
  reportingEndpointsHeader,
  resolveCspMode,
  type CspInputs,
} from './content-security-policy';

const BASE: CspInputs = {
  nonce: 'dGVzdC1ub25jZS0xMjM0',
  firebaseAuthDomain: 'verdery-dev.firebaseapp.com',
  apiOrigin: undefined,
  authEmulatorOrigin: undefined,
  development: false,
};

/** Reads one directive out of the policy string. */
function directive(policy: string, name: string): string {
  const found = policy.split('; ').find((entry) => entry === name || entry.startsWith(`${name} `));
  expect(found, `policy has no "${name}" directive`).toBeDefined();
  return found as string;
}

describe('script-src — the directive the old policy gave away', () => {
  it("no longer contains 'unsafe-inline'", () => {
    // The single most important assertion in this file. With 'unsafe-inline'
    // an enforced policy would not have stopped the injected inline script it
    // exists to stop, which is why threat-model.md 16.4 called a nonce a
    // precondition for enforcement being "meaningful".
    expect(directive(buildContentSecurityPolicy(BASE), 'script-src')).not.toContain(
      "'unsafe-inline'",
    );
  });

  it('carries the per-request nonce Next.js stamps on its inline bootstrap', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'script-src')).toContain(
      `'nonce-${BASE.nonce}'`,
    );
  });

  it('produces a different policy for a different nonce', () => {
    const first = buildContentSecurityPolicy(BASE);
    const second = buildContentSecurityPolicy({ ...BASE, nonce: 'YW5vdGhlci1ub25jZQ==' });
    expect(first).not.toBe(second);
  });

  it('admits reCAPTCHA Enterprise, which App Check loads and cannot work without', () => {
    const scriptSrc = directive(buildContentSecurityPolicy(BASE), 'script-src');
    expect(scriptSrc).toContain(CSP_ORIGINS.recaptcha);
    expect(scriptSrc).toContain(CSP_ORIGINS.recaptchaAssets);
  });

  it('admits the Google API loader, without which signInWithPopup cannot open', () => {
    // Firebase Auth injects `https://apis.google.com/js/api.js` to build its
    // auth iframe. The enforcing E2E run found this the only way it could be
    // found: Google sign-in failing with "Sign-in did not succeed" and no
    // other symptom. This is a PRODUCTION path, not a harness artefact.
    expect(directive(buildContentSecurityPolicy(BASE), 'script-src')).toContain(
      CSP_ORIGINS.googleApiLoader,
    );
  });

  it("never contains 'unsafe-eval' in a production build", () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'script-src')).not.toContain(
      "'unsafe-eval'",
    );
  });

  it("allows 'unsafe-eval' only under next dev, whose React Refresh runtime needs it", () => {
    expect(
      directive(buildContentSecurityPolicy({ ...BASE, development: true }), 'script-src'),
    ).toContain("'unsafe-eval'");
  });
});

describe('connect-src — every XHR the application actually makes', () => {
  const connectSrc = () => directive(buildContentSecurityPolicy(BASE), 'connect-src');

  it('admits Firebase Identity Toolkit, without which sign-in cannot complete', () => {
    expect(connectSrc()).toContain(CSP_ORIGINS.identityToolkit);
  });

  it('admits Secure Token, without which the session silently dies at the first refresh', () => {
    expect(connectSrc()).toContain(CSP_ORIGINS.secureToken);
  });

  it('admits App Check token exchange, without which attestation never happens', () => {
    // The `content-` host is the one the browser SDK really calls. Naming
    // only the bare host blocked every attestation on every route in the
    // enforcing E2E run — silently, because App Check failure is a soft
    // signal by design. Both are asserted so neither can be dropped.
    expect(connectSrc()).toContain(CSP_ORIGINS.appCheckContent);
    expect(connectSrc()).toContain(CSP_ORIGINS.appCheck);
  });

  it('admits Cloud Storage, which the browser PUTs upload bytes to directly', () => {
    // media bypasses the API data path by design, so `'self'` covers none of it.
    expect(connectSrc()).toContain(CSP_ORIGINS.cloudStorage);
  });

  it('admits the basemap tile host, without which the map renders nothing', () => {
    expect(connectSrc()).toContain(CSP_ORIGINS.basemapTiles);
  });

  it("relies on 'self' for the API in the deployed configuration", () => {
    // `NEXT_PUBLIC_API_ORIGIN=same-origin` means /v1/* is proxied by this very
    // server. Naming a cross-origin API host in the deployed policy would
    // widen it for a call the browser never makes.
    expect(connectSrc()).toContain("'self'");
    expect(connectSrc()).not.toContain('localhost');
  });

  it('admits a genuinely cross-origin API when local development has one', () => {
    expect(
      directive(
        buildContentSecurityPolicy({ ...BASE, apiOrigin: 'http://localhost:8080' }),
        'connect-src',
      ),
    ).toContain('http://localhost:8080');
  });

  it('admits the Auth emulator only when the E2E harness asked for it', () => {
    expect(connectSrc()).not.toContain('127.0.0.1:9099');
    expect(
      directive(
        buildContentSecurityPolicy({ ...BASE, authEmulatorOrigin: 'http://127.0.0.1:9099' }),
        'connect-src',
      ),
    ).toContain('http://127.0.0.1:9099');
  });
});

describe('frame-src — the Firebase Auth iframe signInWithPopup installs', () => {
  it('admits the configured auth domain, so Google and Apple sign-in complete', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'frame-src')).toContain(
      'https://verdery-dev.firebaseapp.com',
    );
  });

  it('names the exact domain rather than wildcarding every Firebase project', () => {
    const frameSrc = directive(buildContentSecurityPolicy(BASE), 'frame-src');
    expect(frameSrc).not.toContain('*.firebaseapp.com');
  });

  it('admits the reCAPTCHA challenge iframe', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'frame-src')).toContain(
      CSP_ORIGINS.recaptcha,
    );
  });

  it('admits the Auth emulator when the harness uses it — found by the enforcing E2E run', () => {
    // `connectAuthEmulator` redirects the hidden auth iframe to the emulator
    // instead of the real auth domain. With the emulator origin in
    // `connect-src` only, popup sign-in fails with "Sign-in did not succeed"
    // and no other diagnostic. This assertion is what stops that recurring.
    expect(
      directive(
        buildContentSecurityPolicy({ ...BASE, authEmulatorOrigin: 'http://127.0.0.1:9099' }),
        'frame-src',
      ),
    ).toContain('http://127.0.0.1:9099');
  });

  it('does not admit the emulator in a deployed configuration', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'frame-src')).not.toContain('127.0.0.1');
  });

  it('degrades to reCAPTCHA alone when no auth domain is configured', () => {
    const frameSrc = directive(
      buildContentSecurityPolicy({ ...BASE, firebaseAuthDomain: undefined }),
      'frame-src',
    );
    expect(frameSrc).toBe(`frame-src ${CSP_ORIGINS.recaptcha}`);
  });
});

describe('worker-src — MapLibre builds its worker from a blob URL', () => {
  it('allows blob:, without which the map renders nothing at all', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'worker-src')).toBe(
      "worker-src 'self' blob:",
    );
  });

  it('is stated explicitly rather than inherited from default-src', () => {
    // worker-src falls back to child-src and then default-src, and inheriting
    // `'self'` from default-src is exactly the failure this prevents.
    expect(directive(buildContentSecurityPolicy(BASE), 'default-src')).toBe("default-src 'self'");
  });
});

describe('img-src', () => {
  it('allows the signed Cloud Storage URLs media previews render', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'img-src')).toContain(
      CSP_ORIGINS.cloudStorage,
    );
  });

  it('allows blob: for a locally selected file before it is uploaded', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'img-src')).toContain('blob:');
  });

  it('allows data: for the inline SVG chevron in tokens.css', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'img-src')).toContain('data:');
  });
});

describe('style-src', () => {
  it("keeps 'unsafe-inline', because React renders the style prop as an attribute", () => {
    // A nonce cannot apply to a style ATTRIBUTE, only to a <style> element.
    // Documented rather than pretended away: the residual risk is CSS
    // injection, a category weaker than script injection.
    expect(directive(buildContentSecurityPolicy(BASE), 'style-src')).toContain("'unsafe-inline'");
  });

  it('carries no nonce, which would silently disable that unsafe-inline', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'style-src')).not.toContain('nonce-');
  });
});

describe('the hardening directives', () => {
  it.each([
    ['object-src', "object-src 'none'"],
    ['frame-ancestors', "frame-ancestors 'none'"],
    ['base-uri', "base-uri 'self'"],
    ['form-action', "form-action 'self'"],
    ['font-src', "font-src 'self'"],
  ])('%s is %s', (name, expected) => {
    expect(directive(buildContentSecurityPolicy(BASE), name)).toBe(expected);
  });
});

describe('violation reporting — threat-model.md 16.4 first finding', () => {
  it('declares report-uri, the only mechanism Safari and Firefox implement', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'report-uri')).toBe(
      `report-uri ${CSP_REPORT_PATH}`,
    );
  });

  it('declares report-to, which is what Chrome honors', () => {
    expect(directive(buildContentSecurityPolicy(BASE), 'report-to')).toBe(
      `report-to ${CSP_REPORT_GROUP}`,
    );
  });

  it('declares the Reporting-Endpoints group report-to names', () => {
    // Without this companion header, `report-to` points at a group that was
    // never declared and Chrome discards the report silently — recreating the
    // exact "declared but collecting nothing" state this work package ends.
    expect(reportingEndpointsHeader()).toBe(`${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  });

  it('reports first-party, to a path on this same origin', () => {
    expect(CSP_REPORT_PATH.startsWith('/')).toBe(true);
  });
});

describe('the mode switch — the gated half of P8-SEC-02', () => {
  it('defaults to report-only when nothing is configured', () => {
    expect(resolveCspMode(undefined)).toBe('report-only');
    expect(cspHeaderName(resolveCspMode(undefined))).toBe(CSP_REPORT_ONLY_HEADER);
  });

  it('enforces only on the exact string "enforce"', () => {
    expect(resolveCspMode('enforce')).toBe('enforce');
    expect(cspHeaderName(resolveCspMode('enforce'))).toBe(CSP_ENFORCE_HEADER);
  });

  it.each(['Enforce', 'ENFORCE', 'true', '1', 'yes', 'enforcing', ''])(
    'treats %o as report-only: a typo must fail toward not breaking the product',
    (value) => {
      expect(resolveCspMode(value)).toBe('report-only');
    },
  );

  it('changes only the header NAME, never the policy itself', () => {
    // This is what makes the enforcing E2E run evidence about the report-only
    // policy too: both modes ship byte-identical directives.
    const policy = buildContentSecurityPolicy(BASE);
    expect(cspHeaderName('enforce')).not.toBe(cspHeaderName('report-only'));
    expect(buildContentSecurityPolicy(BASE)).toBe(policy);
  });
});

describe('the policy as a whole', () => {
  it('never emits an empty or duplicated source in a directive', () => {
    const policy = buildContentSecurityPolicy({
      ...BASE,
      apiOrigin: 'https://storage.googleapis.com',
      authEmulatorOrigin: 'https://storage.googleapis.com',
    });

    for (const entry of policy.split('; ')) {
      const sources = entry.split(' ').slice(1);
      expect(sources).not.toContain('');
      expect(new Set(sources).size).toBe(sources.length);
    }
  });

  it('would still have broken sign-in and upload in its previous form', () => {
    // A regression guard written as a statement about history: the old policy
    // is reproduced here, and the assertion is that it lacks what the current
    // one has. If someone ever "simplifies" back toward it, this fails.
    const previous = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'";
    expect(previous).not.toContain(CSP_ORIGINS.identityToolkit);
    expect(previous).not.toContain(CSP_ORIGINS.cloudStorage);
    expect(previous).not.toContain('report-uri');

    const current = buildContentSecurityPolicy(BASE);
    expect(current).toContain(CSP_ORIGINS.identityToolkit);
    expect(current).toContain(CSP_ORIGINS.cloudStorage);
    expect(current).toContain('report-uri');
  });
});
