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
  }
}
