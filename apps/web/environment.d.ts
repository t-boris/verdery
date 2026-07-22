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
  }
}
