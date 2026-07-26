/**
 * Classifies the Firebase App Check token on every request it applies to,
 * logs the outcome, and — only when configuration says so, and only on the
 * reviewed endpoint list — rejects.
 *
 * ROLLOUT STATE. Stages 1 and 2 (token generation, backend monitoring) have
 * shipped. Stage 3 (enforcement) is BUILT here but OFF: the mode comes from
 * `APP_CHECK_ENFORCEMENT`, whose schema default is `monitor`, and every
 * environment today runs the default. That is the deliberate shape asked of
 * `P8-SEC-02`'s buildable half — the switch exists, both of its positions are
 * tested, and turning it is a deployment variable change rather than a code
 * change made under time pressure.
 *
 * WHAT MONITOR MODE NOW DOES THAT IT DID NOT BEFORE. It records, per request,
 * whether enforcement WOULD have rejected it (`outcome: 'wouldReject'`). The
 * flip has been blocked on beta telemetry that did not exist; this is that
 * telemetry, and it is produced by the same code path enforcement will use,
 * so the number describes the real rule rather than an approximation of it.
 *
 * `X-Firebase-AppCheck` is Firebase's documented conventional header for
 * custom (non-Cloud-Functions) backends. The header value is never logged,
 * only the resulting classification, outcome, and route — matching the "does
 * not reveal whether a garden or account exists" privacy bar the rollout is
 * held to, applied to the monitoring signal itself and not just to
 * enforcement.
 *
 * REJECTION IS BLIND BY CONSTRUCTION. This hook is registered before
 * `registerAuthentication` in the same encapsulation block, so a rejection
 * happens before any credential is verified, any profile is provisioned, and
 * any garden is looked up. There is no ordering in which an App Check refusal
 * could disclose whether a garden or an account exists, because nothing has
 * been read yet when it fires.
 *
 * Source: architecture/identity-and-authorization.md, section "12. App
 * Check"; docs/implementation-plan.md, work packages P2-APPCHK-01 and
 * P8-SEC-02; docs/development/threat-model.md, section 13 (`T-COST-10`).
 */

import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../errors/application-error.js';
import {
  decideAppCheckOutcome,
  isEnforcedEndpoint,
  type AppCheckEnforcementMode,
} from './app-check-enforcement.js';
import type { AppCheckClassification, AppCheckVerifier } from './app-check-verifier.js';

export const APP_CHECK_HEADER = 'x-firebase-appcheck';

/**
 * Transport-owned error code, following `ROUTE_NOT_FOUND_CODE`'s precedent in
 * `errors/error-handler.ts`: the shared catalogue in `@verdery/api-contracts`
 * covers pipeline outcomes every client must handle on every endpoint, and app
 * attestation is not one of them — it applies to a named subset, and it is a
 * client-integrity outcome rather than a user-authorization one.
 *
 * Distinct from `auth.forbidden` on purpose. An operator turning enforcement
 * on needs to tell "this client is not attested" apart from "this user may not
 * do this", and a client needs to tell "refresh your App Check token and
 * retry" apart from "stop asking". One shared code would collapse both.
 */
export const APP_CHECK_REJECTED_CODE = 'request.app_check_rejected';

export interface AppCheckPluginDependencies {
  readonly appCheckVerifier: AppCheckVerifier;
  /**
   * Defaults to `'monitor'` when omitted, so a caller that has not thought
   * about enforcement cannot accidentally acquire it. `app.ts` always passes
   * the configured value explicitly.
   */
  readonly enforcementMode?: AppCheckEnforcementMode;
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
  const mode: AppCheckEnforcementMode = dependencies.enforcementMode ?? 'monitor';

  app.addHook('onRequest', async (request) => {
    const token = extractToken(request.headers[APP_CHECK_HEADER]);

    let classification: AppCheckClassification;
    try {
      classification = await dependencies.appCheckVerifier.classify(token);
    } catch {
      // classify() is documented to never throw; this catch exists so that a
      // misbehaving verifier still cannot turn a pure-observation hook into a
      // request-blocking one. It still classifies as 'invalid', which
      // enforcement rejects — the deliberate fail-CLOSED choice for a control
      // whose entire purpose is to refuse callers it cannot vouch for. In
      // monitor mode, which is every environment today, the same line is
      // merely logged.
      classification = 'invalid';
    }

    const routeUrl = request.routeOptions?.url ?? request.url;
    const outcome = decideAppCheckOutcome({
      mode,
      classification,
      method: request.method,
      routeUrl,
    });

    request.log.info(
      {
        event: 'app_check.classified',
        classification,
        path: routeUrl,
        // The three fields the enforcement flip is decided on. `enforced`
        // says whether the route is on the reviewed list at all; `mode` says
        // which position the switch is in; `outcome` says what actually
        // happened. Together they answer "if this were flipped today, what
        // would break?" from ordinary production logs, with no new
        // instrumentation and no new storage.
        enforced: isEnforcedEndpoint(request.method, routeUrl),
        mode,
        outcome,
      },
      'App Check token classified',
    );

    if (outcome === 'rejected') {
      throw new ForbiddenError(
        APP_CHECK_REJECTED_CODE,
        'This request must carry a valid App Check token.',
      );
    }
  });
}
