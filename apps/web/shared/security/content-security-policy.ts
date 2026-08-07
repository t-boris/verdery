/**
 * The Content Security Policy this application actually needs, built per
 * request so it can carry a nonce.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The policy that shipped before `P8-SEC-02` was, verbatim:
 *
 *     default-src 'self'; script-src 'self' 'unsafe-inline';
 *     style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
 *     font-src 'self'; connect-src 'self'; frame-ancestors 'none';
 *     base-uri 'self'; form-action 'self'
 *
 * threat-model.md section 16.4 recorded two facts about it, and both are
 * confirmed by what this application does at runtime:
 *
 * 1. It declared no `report-uri` and no `report-to`, so a violation went to a
 *    browser console and nowhere else. "Report-only" was true of the mode and
 *    false of the practice: nothing was reporting.
 * 2. Enforced as written, it would BREAK THE PRODUCT. `connect-src 'self'`
 *    alone kills Firebase sign-in (`identitytoolkit.googleapis.com`), token
 *    refresh (`securetoken.googleapis.com`), App Check attestation
 *    (`firebaseappcheck.googleapis.com`), every media upload and download
 *    (`storage.googleapis.com`), and the whole map (`tile.openstreetmap.org`).
 *    `default-src 'self'` additionally kills MapLibre's blob-URL web worker,
 *    the reCAPTCHA Enterprise script App Check loads, and the Firebase Auth
 *    iframe `signInWithPopup` installs. And `script-src 'unsafe-inline'`
 *    means the directive that matters most was not protecting anything: an
 *    injected `<script>` would have been allowed by the policy.
 *
 * WHAT THIS ONE DOES DIFFERENTLY
 *
 * Every origin below is one this application demonstrably contacts, traced to
 * the code that contacts it. `'unsafe-inline'` is gone from `script-src`,
 * replaced by a per-request nonce that Next.js stamps onto its own inline
 * bootstrap. And the policy names a first-party reporting endpoint, so
 * violations become log lines instead of console noise.
 *
 * WHAT IS STILL DELIBERATELY REPORT-ONLY
 *
 * The mode. `resolveCspMode` defaults to `report-only`, and flipping it is
 * `P8-SEC-02`'s gated half. What is NOT deferred is the evidence: the
 * Playwright suite loads every route with this exact policy applied in
 * ENFORCING mode and fails on any violation, so the flip is a configuration
 * change against a tested policy rather than a hopeful one.
 *
 * Source: architecture/web-application-design.md, section "16. Security";
 * docs/development/threat-model.md, sections 16.3 and 16.4.
 */

/** Which header name the policy is served under. */
export type CspMode = 'report-only' | 'enforce';

export const CSP_ENFORCE_HEADER = 'Content-Security-Policy';
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

/**
 * Where violations are posted. A first-party route in this same application
 * (`app/internal/csp-report/route.ts`), NOT a third-party collector.
 *
 * The alternative — a hosted reporting service — would have meant a new
 * vendor, a new outbound data flow carrying URLs from users' sessions, and a
 * new threat-model review, to solve a problem this application's own logs
 * already solve: it runs on Cloud Run, so a structured line on stdout is in
 * Cloud Logging, which is where every other operational signal in this system
 * already goes.
 */
export const CSP_REPORT_PATH = '/internal/csp-report';

/** The `Reporting-Endpoints` group name `report-to` refers to. */
export const CSP_REPORT_GROUP = 'csp';

/**
 * Origins this application contacts, each traced to the code that contacts it.
 * Exported so the tests can assert on the reasons rather than on a string.
 */
export const CSP_ORIGINS = {
  /** Firebase Auth REST: sign-in, email-link completion, account lookup. `core/auth/sign-in.ts`. */
  identityToolkit: 'https://identitytoolkit.googleapis.com',
  /** Firebase ID-token refresh, on a timer for the whole session. `firebase/auth` internals. */
  secureToken: 'https://securetoken.googleapis.com',
  /**
   * App Check token exchange. `core/auth/app-check.ts`.
   *
   * The `content-` prefixed host is the one the BROWSER SDK actually calls
   * (`.../v1/projects/<p>/apps/<id>:exchangeRecaptchaEnterpriseToken`), which
   * the enforcing E2E run established — naming only the bare host below
   * blocked every attestation on every route, silently, because App Check
   * failure is a soft signal by design.
   */
  appCheckContent: 'https://content-firebaseappcheck.googleapis.com',
  /**
   * The documented App Check API host. Kept alongside the `content-` host
   * because which of the two the SDK calls is an internal detail that has
   * changed across Firebase versions, and an SDK upgrade that switches back
   * would otherwise break attestation with no visible symptom.
   */
  appCheck: 'https://firebaseappcheck.googleapis.com',
  /**
   * Cloud Storage. TWO distinct uses, both direct browser-to-GCS and neither
   * proxied through the API: the resumable upload PUT
   * (`features/media/gcs-resumable-transport.ts`) and the signed download URL
   * `GetMediaAccess` returns (`features/media/media-preview.tsx`).
   */
  cloudStorage: 'https://storage.googleapis.com',
  /** Street-map raster tiles. `features/map/basemap-provider.ts`. */
  basemapTiles: 'https://tile.openstreetmap.org',
  /**
   * USGS National Map aerial imagery — the layer a lot is traced from
   * (P12-GEO-01). Public-domain federal imagery, no key, rendered on demand
   * by an ArcGIS `exportImage` endpoint, which is why it needs both
   * `img-src` (the tiles themselves) and `connect-src` (MapLibre fetches
   * them).
   */
  aerialImagery: 'https://imagery.nationalmap.gov',
  /**
   * reCAPTCHA Enterprise, which the App Check SDK loads and runs. Serves the
   * script, the challenge iframe, and the assessment beacon — hence its
   * appearance in `script-src`, `frame-src`, and `connect-src` alike.
   */
  recaptcha: 'https://www.google.com',
  /** Where reCAPTCHA's own script loads its payload from. */
  recaptchaAssets: 'https://www.gstatic.com',
  /**
   * The Google API loader (`/js/api.js`) that Firebase Auth's
   * `signInWithPopup` injects in order to build its auth iframe. Also
   * established by the enforcing E2E run, and the finding with the largest
   * production consequence in this package: without it, Google and Apple
   * sign-in fail on the real site with nothing but "Sign-in did not succeed".
   */
  googleApiLoader: 'https://apis.google.com',
} as const;

export interface CspInputs {
  /**
   * Per-request nonce, base64. Next.js reads it back out of the policy and
   * stamps it on its inline bootstrap and hydration scripts.
   */
  readonly nonce: string;
  /**
   * `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, e.g. `verdery-dev.firebaseapp.com`.
   * `signInWithPopup` installs a hidden iframe pointing at
   * `https://<authDomain>/__/auth/iframe`, so this origin must be in
   * `frame-src` or Google and Apple sign-in do not complete.
   *
   * The exact configured domain rather than `https://*.firebaseapp.com`:
   * wildcarding it would admit every Firebase project on the internet as a
   * framing source, which is a strictly larger hole for no benefit.
   */
  readonly firebaseAuthDomain: string | undefined;
  /**
   * The API origin the browser calls, when it is a DIFFERENT origin from the
   * page. Empty or undefined in the deployed configuration, where
   * `NEXT_PUBLIC_API_ORIGIN` is the `same-origin` sentinel and `/v1/*` is
   * proxied by this very server — `'self'` already covers that. Non-empty in
   * local development (`http://localhost:8080`) and in the E2E harness
   * (`http://localhost:8090`), where it genuinely is cross-origin.
   */
  readonly apiOrigin: string | undefined;
  /**
   * The Firebase Auth emulator origin, when the E2E harness has pointed the
   * SDK at it. Present ONLY when `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` is set,
   * which `firebase-app.ts` documents as never true in a deployed
   * environment. Without it the Playwright suite could not sign in under an
   * enforcing policy — and a suite that has to weaken the policy to pass is
   * not evidence about the policy.
   *
   * It lands in `connect-src` AND `frame-src`, and the second one was found
   * the hard way: `connectAuthEmulator` redirects the hidden iframe that
   * `signInWithPopup` installs — normally `https://<authDomain>/__/auth/iframe`
   * — to the emulator instead. With the emulator origin in `connect-src`
   * alone, Google and Apple sign-in fail with nothing but "Sign-in did not
   * succeed", because the popup never opens. The enforcing E2E run caught
   * exactly this, which is the argument for running the whole suite enforced
   * rather than asserting on the policy string.
   */
  readonly authEmulatorOrigin: string | undefined;
  /**
   * `true` in `next dev`, which serves an eval-based React Refresh runtime
   * and opens a hot-reload connection. Never true in a production build.
   */
  readonly development: boolean;
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => value !== undefined && value !== '')),
  ];
}

/**
 * Builds the policy string.
 *
 * Every directive below carries the reason it is shaped the way it is. That
 * is not decoration: a CSP whose directives nobody can justify is a CSP that
 * gets widened the first time something breaks.
 */
export function buildContentSecurityPolicy(inputs: CspInputs): string {
  const { nonce, firebaseAuthDomain, apiOrigin, authEmulatorOrigin, development } = inputs;

  const firebaseAuthOrigin =
    firebaseAuthDomain === undefined || firebaseAuthDomain === ''
      ? undefined
      : `https://${firebaseAuthDomain}`;

  const directives: string[] = [
    // Everything not named below falls back to same-origin. `object-src` and
    // `frame-ancestors` are still stated explicitly because they do not
    // inherit from `default-src` in every browser's implementation history,
    // and because both are load-bearing.
    "default-src 'self'",

    // NO 'unsafe-inline'. This is the directive the old policy gave away for
    // free, and the reason the old policy would not have stopped an XSS even
    // when enforced.
    //
    // The nonce covers Next.js's own inline bootstrap and per-route
    // hydration payloads; Next.js reads the nonce back out of this very
    // header and stamps it on those tags itself. Every route in this
    // application is server-rendered on demand (`next build` reports every
    // route as `ƒ Dynamic`, because the root layout negotiates locale from
    // request headers), so there is no statically generated HTML carrying a
    // stale nonce — the precondition that makes this approach safe here and
    // would make it dangerous in an app with prerendered pages.
    //
    // The three Google origins are the two SDKs' own machinery, and every one
    // of them was confirmed by watching a real browser under this policy
    // rather than inferred: App Check injects
    // `www.google.com/recaptcha/enterprise.js`, which pulls its
    // implementation from `www.gstatic.com`; Firebase Auth injects
    // `apis.google.com/js/api.js` to build its auth iframe.
    //
    // Host-source expressions rather than `'strict-dynamic'`: strict-dynamic
    // would let ANY script this page trusts load ANY other script, which is a
    // broader grant than naming the origins actually involved.
    unique([
      "script-src 'self'",
      `'nonce-${nonce}'`,
      CSP_ORIGINS.recaptcha,
      CSP_ORIGINS.recaptchaAssets,
      // Firebase Auth's own popup machinery — see `googleApiLoader`.
      CSP_ORIGINS.googleApiLoader,
      // `next dev` compiles with eval-based source maps and a React Refresh
      // runtime that cannot work without it. Production builds never take
      // this branch, and the E2E suite asserts the production shape.
      development ? "'unsafe-eval'" : undefined,
    ]).join(' '),

    // 'unsafe-inline' STAYS here, and the distinction from script-src is the
    // whole point rather than an inconsistency. React renders the `style`
    // prop as an inline `style="..."` ATTRIBUTE, and a nonce cannot apply to
    // an attribute — only to a `<style>` element. Removing it would mean
    // eliminating every inline style in the application, including the ones
    // MapLibre and react-konva set on canvases they own. The residual risk is
    // CSS injection, which is real but a category weaker than script
    // injection, and it is documented rather than pretended away.
    "style-src 'self' 'unsafe-inline'",

    // `data:` for the SVG chevron in tokens.css; `blob:` for locally selected
    // upload previews before they leave the browser; Cloud Storage for signed
    // download URLs (`media-preview.tsx`); the tile host for basemap raster
    // assets.
    `img-src 'self' data: blob: ${CSP_ORIGINS.cloudStorage} ${CSP_ORIGINS.basemapTiles} ${CSP_ORIGINS.aerialImagery}`,

    // Self only: this application ships no web fonts and uses the platform
    // font stack (`shared/ui/tokens.css`). Stated rather than left to
    // `default-src` so that adding a font host later is a visible decision.
    "font-src 'self'",

    unique([
      "connect-src 'self'",
      CSP_ORIGINS.identityToolkit,
      CSP_ORIGINS.secureToken,
      CSP_ORIGINS.appCheckContent,
      CSP_ORIGINS.appCheck,
      CSP_ORIGINS.cloudStorage,
      CSP_ORIGINS.basemapTiles,
      CSP_ORIGINS.aerialImagery,
      // reCAPTCHA posts its assessment beacon here.
      CSP_ORIGINS.recaptcha,
      // Cross-origin only in local development and the E2E harness; the
      // deployed build proxies /v1/* through this server, so 'self' covers it
      // and this contributes nothing.
      apiOrigin,
      authEmulatorOrigin,
      // `next dev`'s hot-reload channel.
      development ? 'ws:' : undefined,
    ]).join(' '),

    // MapLibre GL builds its worker from a Blob URL
    // (`new Worker(URL.createObjectURL(blob))`), so `blob:` here is not
    // optional — without it the map renders nothing at all. Stated as its own
    // directive because `worker-src` falls back to `child-src` and then
    // `default-src`, and inheriting `'self'` from `default-src` is exactly
    // the failure this line prevents.
    "worker-src 'self' blob:",

    // Firebase Auth's `signInWithPopup` installs a hidden iframe at
    // `https://<authDomain>/__/auth/iframe`; reCAPTCHA installs the challenge
    // iframe. Without both entries, Google and Apple sign-in do not complete.
    unique([
      'frame-src',
      firebaseAuthOrigin,
      CSP_ORIGINS.recaptcha,
      // See `authEmulatorOrigin`. `connectAuthEmulator` redirects Firebase
      // Auth's iframe away from the real auth domain, so the deployed entry
      // above does not cover the harness. Conditional on the emulator flag,
      // so it can never widen a deployed policy.
      authEmulatorOrigin,
    ]).join(' '),

    // No plugins. Explicit rather than inherited: this is a cheap, absolute
    // control and inheritance has been inconsistent across browsers.
    "object-src 'none'",

    // This application is never framed. Pairs with the X-Frame-Options header
    // `next.config.ts` already sends, for browsers that honor only the older
    // one.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",

    // The fix for threat-model.md 16.4's first finding. `report-uri` is
    // formally deprecated but is still the only mechanism Safari and Firefox
    // implement; `report-to` is what Chrome now honors. Both are emitted, so
    // a violation is collected in every browser this application supports
    // (`package.json` browserslist) rather than in one of them.
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ];

  return directives.join('; ');
}

/**
 * The companion header `report-to` needs. Without it, `report-to` names a
 * group that was never declared and Chrome discards the report silently —
 * which would recreate exactly the "declared but collecting nothing" state
 * this work package exists to fix.
 *
 * The endpoint is a SAME-ORIGIN RELATIVE path, resolved by the browser
 * against the document. An absolute URL would have to be composed from the
 * request's own host, which behind a load balancer is not reliably the host
 * the browser used — a wrong absolute URL delivers reports nowhere, while a
 * relative one cannot be wrong. `report-uri` takes the same relative path and
 * is still honored by every browser in this application's browserslist, so it
 * is the guaranteed delivery path regardless.
 */
export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}

/**
 * Reads the mode from configuration, defaulting to `report-only`.
 *
 * Anything other than the exact string `enforce` means report-only. A typo
 * must fail SAFE — toward not breaking the product — because the failure mode
 * of accidental enforcement is a blank page for every user, while the failure
 * mode of accidental report-only is the status quo.
 */
export function resolveCspMode(value: string | undefined): CspMode {
  return value === 'enforce' ? 'enforce' : 'report-only';
}

/** The header name a mode is served under. */
export function cspHeaderName(mode: CspMode): string {
  return mode === 'enforce' ? CSP_ENFORCE_HEADER : CSP_REPORT_ONLY_HEADER;
}
