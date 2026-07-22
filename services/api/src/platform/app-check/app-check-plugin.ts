/**
 * Logs the App Check classification of every request it applies to.
 *
 * Stage 1+2 of the documented rollout only: token verification is wired and
 * the outcome is observed, but nothing is ever enforced or rejected on it.
 * Stage 3 (enforcement) is a distinct, later change.
 *
 * `X-Firebase-AppCheck` is Firebase's documented conventional header for
 * custom (non-Cloud-Functions) backends. The header value is never logged,
 * only the resulting classification and route — matching the "does not
 * reveal whether a garden or account exists" privacy bar the rollout is held
 * to, applied here to the monitoring signal itself, not just to enforcement.
 *
 * Registered in the same encapsulation block as `registerAuthentication`:
 * P2-APPCHK-01 depends on P2-AUTH-01 and its completion evidence ("dashboard
 * shows client classes without user content") concerns the authenticated
 * garden routes, so there is no requirement to observe the unauthenticated
 * health or session-login routes as well.
 *
 * Source: architecture/identity-and-authorization.md, section "12. App
 * Check"; docs/implementation-plan.md, work package P2-APPCHK-01.
 */

import type { FastifyInstance } from 'fastify';
import type { AppCheckClassification, AppCheckVerifier } from './app-check-verifier.js';

export const APP_CHECK_HEADER = 'x-firebase-appcheck';

export interface AppCheckPluginDependencies {
  readonly appCheckVerifier: AppCheckVerifier;
}

function extractToken(header: string | string[] | undefined): string | undefined {
  // A repeated header arrives as an array; there is no well-defined "correct"
  // element to trust, so it is treated the same as no header at all rather
  // than guessing.
  return typeof header === 'string' ? header : undefined;
}

export function registerAppCheck(
  app: FastifyInstance,
  dependencies: AppCheckPluginDependencies,
): void {
  app.addHook('onRequest', async (request) => {
    const token = extractToken(request.headers[APP_CHECK_HEADER]);

    let classification: AppCheckClassification;
    try {
      classification = await dependencies.appCheckVerifier.classify(token);
    } catch {
      // classify() is documented to never throw; this catch exists so that a
      // misbehaving verifier still cannot turn a pure-observation hook into a
      // request-blocking one.
      classification = 'invalid';
    }

    request.log.info(
      {
        event: 'app_check.classified',
        classification,
        path: request.routeOptions?.url ?? request.url,
      },
      'App Check token classified',
    );
  });
}
