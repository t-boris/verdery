/**
 * Environment variables read by the web application.
 *
 * Declaring them explicitly rather than reading through the `ProcessEnv` index
 * signature keeps `noPropertyAccessFromIndexSignature` satisfied and keeps the
 * `process.env.NAME` member access that the bundler needs in order to inline
 * `NEXT_PUBLIC_` values into the client bundle.
 *
 * Only non-secret values may appear here: secrets never use `NEXT_PUBLIC_`
 * variables.
 *
 * Source: architecture/web-application-design.md, section "16. Security".
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** Origin of the Verdery API, without a trailing slash and without the version path. */
    readonly NEXT_PUBLIC_API_ORIGIN?: string;

    /**
     * Firebase web app config. Every value here is a public per-project
     * identifier documented by Firebase as safe to ship in a client bundle —
     * not a secret — protected by Firebase Security Rules and App Check
     * rather than by being hidden.
     *
     * Source: architecture/identity-and-authorization.md, section
     * "2. Identity Authority".
     */
    readonly NEXT_PUBLIC_FIREBASE_API_KEY?: string;
    readonly NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
    readonly NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
    readonly NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
    readonly NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
    readonly NEXT_PUBLIC_FIREBASE_APP_ID?: string;

    /**
     * App Check reCAPTCHA Enterprise site key. A reCAPTCHA site key is a
     * public per-site identifier meant to ship in the client bundle — not a
     * secret, the same reasoning as the Firebase values above.
     *
     * Source: architecture/identity-and-authorization.md, section
     * "12. App Check".
     */
    readonly NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;

    /**
     * Set to `"true"` to point the Firebase client SDK at the local Auth
     * emulator instead of real Firebase. Read once, at first use, by
     * `core/auth/firebase-app.ts#getFirebaseAuth`.
     *
     * Only the Playwright E2E harness sets this — see `apps/web/e2e/run-e2e.sh`
     * — never a deployed environment.
     */
    readonly NEXT_PUBLIC_USE_FIREBASE_EMULATOR?: string;

    /**
     * P8-SEC-02: which header the Content Security Policy is served under.
     * `"enforce"` serves it as `Content-Security-Policy`; anything else,
     * including absence, serves it as `Content-Security-Policy-Report-Only`.
     *
     * Read server-side only, by `apps/web/proxy.ts` — deliberately NOT a
     * `NEXT_PUBLIC_` variable, because the browser has no use for it and a
     * value inlined into the client bundle could not be changed without a
     * rebuild.
     *
     * Default (absent) is report-only, and a typo is report-only: accidental
     * enforcement is a blank page for every user, while accidental
     * report-only is the status quo.
     */
    readonly WEB_CSP_MODE?: string;
  }
}
