import { getAppCheckToken, redirectToSignIn, refreshSessionCookie } from '@/core/auth/public';

import { createApiClient, type ApiClient } from './client';
import { withSessionRecovery } from './session-recovery';
import { createSessionGateway } from './session-gateway';

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

  // The deployed build sets the literal sentinel 'same-origin': the web
  // server proxies /v1/* to the API (next.config.ts rewrites), so browser
  // requests stay first-party and the strict session cookie works. An
  // explicit sentinel rather than '' because '' already means "use the
  // local-development default" below.
  if (configured === 'same-origin') {
    return '';
  }

  const origin = configured === undefined || configured === '' ? DEFAULT_API_ORIGIN : configured;

  return origin.replace(/\/+$/u, '');
}

/**
 * Creates the client the browser uses, bound to the platform `fetch` and to
 * this application's session policy.
 *
 * The session-recovery decorator wraps the transport, and the session
 * endpoints it calls to recover run on the UNWRAPPED client: a refresh that
 * failed with `auth.unauthenticated` must not trigger another refresh.
 */
export function createBrowserApiClient(): ApiClient {
  const transport = createApiClient({
    origin: resolveApiOrigin(),
    // `fetch` is reached through an adapter so that gateways stay testable and
    // do not depend on a browser global.
    // Source: architecture/web-application-design.md, section "20. Dependency Rules".
    fetchImplementation: (input, init) => globalThis.fetch(input, init),
    // Every caller of `createBrowserApiClient` runs inside a `'use client'`
    // component, so wiring the real Firebase App Check call here never
    // reaches server rendering.
    getAppCheckToken,
  });

  const sessions = createSessionGateway(transport);

  return withSessionRecovery(transport, {
    recover: () =>
      refreshSessionCookie(async (idToken) => (await sessions.createSession(idToken)).ok),
    abandon: async () => {
      // Clearing the cookie is not tidiness, it is what makes the redirect
      // terminate: `proxy.ts` routes on the cookie's PRESENCE, so a stale
      // cookie left in place would bounce `/auth/sign-in` straight back to
      // `/application/gardens`, which would fail the same way and redirect
      // again. `DELETE /auth/session` is idempotent and clears the cookies
      // even for a session it cannot verify.
      await sessions.endSession();
      redirectToSignIn();
    },
  });
}
