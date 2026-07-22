import { createApiClient, type ApiClient } from './client';

/**
 * Origin used when no environment value is configured.
 *
 * `8080` is the port the API container listens on locally and on Cloud Run.
 */
const DEFAULT_API_ORIGIN = 'http://localhost:8080';

/**
 * Resolves the API origin.
 *
 * A `NEXT_PUBLIC_` variable is correct here because the browser must know where
 * to send requests; it stays correct only as long as the value is not a secret.
 *
 * Source: architecture/web-application-design.md, section "16. Security".
 */
export function resolveApiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN;
  const origin = configured === undefined || configured === '' ? DEFAULT_API_ORIGIN : configured;

  return origin.replace(/\/+$/u, '');
}

/** Creates the client the browser uses, bound to the platform `fetch`. */
export function createBrowserApiClient(): ApiClient {
  return createApiClient({
    origin: resolveApiOrigin(),
    // `fetch` is reached through an adapter so that gateways stay testable and
    // do not depend on a browser global.
    // Source: architecture/web-application-design.md, section "20. Dependency Rules".
    fetchImplementation: (input, init) => globalThis.fetch(input, init),
  });
}
