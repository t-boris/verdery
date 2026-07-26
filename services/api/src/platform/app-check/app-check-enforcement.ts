/**
 * The App Check enforcement policy: WHICH endpoints enforcement applies to,
 * and WHAT a given mode does about a classification on one of them.
 *
 * Deliberately split from `app-check-plugin.ts`, and deliberately pure. Two
 * separate things are being decided here and they have different lifecycles:
 *
 * - The endpoint SET is a reviewed security decision, so it lives in code and
 *   is pinned by tests. An operator must not be able to widen or narrow the
 *   blast radius of an enforcement flip by editing an environment variable at
 *   3am; changing what is protected is a code change that goes through review.
 * - The MODE is an operational decision, so it is configuration
 *   (`APP_CHECK_ENFORCEMENT`, default `monitor`). Flipping enforcement on is
 *   then a deployment variable change, not a code change under time pressure —
 *   and, just as importantly, flipping it back off is too.
 *
 * WHY THESE FIVE ENDPOINTS
 *
 * `T-COST-10` names the threat ("automated/scripted abuse indistinguishable
 * from a real client") and `P8-SEC-02` scopes the answer to "the expensive
 * endpoints" rather than the whole surface. Expensive here means "one
 * unauthenticated or cheap-to-issue request causes work or storage that is
 * billed", which is the section 13 register's own definition. Each entry below
 * names the register row it closes.
 *
 * Source: docs/development/threat-model.md, section 13 (`T-COST-02`,
 * `T-COST-03`, `T-COST-04`, `T-COST-06`, `T-COST-07`, `T-COST-10`);
 * docs/implementation-plan.md, work package `P8-SEC-02`;
 * architecture/identity-and-authorization.md, section "12. App Check"
 * (rollout stage 3).
 */

import { API_BASE_PATH } from '@verdery/api-contracts';
import type { AppCheckClassification } from './app-check-verifier.js';

/**
 * `monitor` — classify and log, never reject. The state of every environment
 * today and the default of the configuration schema.
 *
 * `enforce` — additionally reject a non-`valid` classification, but only on
 * {@link APP_CHECK_ENFORCED_ENDPOINTS}. Every other route stays monitor-only
 * even in this mode: enforcement that covered the whole surface would make one
 * misconfigured client a total outage rather than a degraded one.
 */
export type AppCheckEnforcementMode = 'monitor' | 'enforce';

/** One endpoint enforcement applies to, with the reason it is on the list. */
export interface EnforcedEndpoint {
  /** Uppercase HTTP method, as Fastify reports it on the request. */
  readonly method: string;
  /** Route URL as Fastify registered it — parameterized, and including the API base path. */
  readonly url: string;
  /** The threat-model register row this entry closes. Not decoration: it is what makes the list reviewable. */
  readonly rationale: string;
}

/**
 * The reviewed list. Ordered by how cheap the request is to issue, which is
 * the same as ordering by how badly the endpoint needs attestation.
 */
export const APP_CHECK_ENFORCED_ENDPOINTS: readonly EnforcedEndpoint[] = [
  {
    method: 'POST',
    url: `${API_BASE_PATH}/auth/session`,
    rationale:
      'T-COST-02: the most expensive UNAUTHENTICATED endpoint in the product. Every call costs a ' +
      'Firebase verifyIdToken AND a createSessionCookie, and nothing throttles it. It is also the ' +
      'only entry on this list a caller can reach with no credential at all, which is why it is first.',
  },
  {
    method: 'POST',
    url: `${API_BASE_PATH}/gardens/:gardenId/media`,
    rationale:
      'T-COST-03 and T-COST-04: registration is what reserves storage and opens a resumable upload ' +
      'session, and one accepted upload fans out into validation, derivatives, and a tile pyramid. ' +
      'The reserve/commit/release mechanism is correct but no numeric ceiling exists, so the only ' +
      'bound available today is on WHO may start the fan-out.',
  },
  {
    method: 'POST',
    url: `${API_BASE_PATH}/gardens/:gardenId/media/:mediaId/complete`,
    rationale:
      'T-COST-04: completion is the call that actually enqueues the processing job. Enforcing ' +
      'registration without completion would leave the amplification step reachable on its own by a ' +
      'caller replaying a session id it already holds.',
  },
  {
    method: 'POST',
    url: `${API_BASE_PATH}/exports`,
    rationale:
      'T-COST-06: generating an export ZIP is the single highest-cost per-user operation and the ' +
      'highest-value data egress in the product. It already has the codebase’s only real per-user ' +
      'rate limit (one active export per requester), so this is defence in depth rather than the only line.',
  },
  {
    method: 'GET',
    url: `${API_BASE_PATH}/gardens/:gardenId/today`,
    rationale:
      'T-COST-07 and T-COST-10: the Today read is the evaluation surface — it is what serves ' +
      'recommendation output and, when the AI-explanation kill-switch is on, what consumes the ' +
      'provider call budget. The evaluation SWEEP itself is out of App Check’s reach by design: ' +
      'Cloud Tasks calls it with a Google-signed OIDC token, not an app attestation.',
  },
];

/**
 * Endpoints deliberately NOT enforced, recorded so the omissions are decisions
 * rather than oversights. Exported because a test pins it: an endpoint must not
 * silently appear in both lists.
 *
 * - Every `/v1/internal/*` route: authenticated by a Google-signed OIDC token
 *   from Cloud Tasks (`CloudTasksInvocationVerifier`). A worker has no App
 *   Check token and never will; enforcing here would break every sweep.
 * - `GET /v1/health/*`: the contract marks these `security: []`, and a probe
 *   that App Check can fail is a probe that reports the wrong thing.
 * - `DELETE /v1/auth/session`: sign-out must succeed even for a client whose
 *   attestation is broken. A user who cannot sign out is a worse outcome than
 *   an unattested sign-out.
 * - `POST /v1/sync/push`: expensive and a genuine candidate, but the native
 *   client's App Check coverage on the offline path is exactly the thing beta
 *   telemetry has to establish first. Listed here so the next review starts
 *   from the open question rather than rediscovering it.
 */
export const APP_CHECK_DELIBERATELY_UNENFORCED: readonly string[] = [
  `${API_BASE_PATH}/internal/*`,
  `${API_BASE_PATH}/health/*`,
  `DELETE ${API_BASE_PATH}/auth/session`,
  `POST ${API_BASE_PATH}/sync/push`,
];

/** Lookup key for {@link APP_CHECK_ENFORCED_ENDPOINTS}. */
function endpointKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

const ENFORCED_KEYS: ReadonlySet<string> = new Set(
  APP_CHECK_ENFORCED_ENDPOINTS.map((endpoint) => endpointKey(endpoint.method, endpoint.url)),
);

/** Whether enforcement applies to this route at all, independent of mode or classification. */
export function isEnforcedEndpoint(method: string, routeUrl: string | undefined): boolean {
  return routeUrl !== undefined && ENFORCED_KEYS.has(endpointKey(method, routeUrl));
}

/**
 * What the pipeline does with one classification.
 *
 * - `observed` — log it and continue. Everything monitor mode has ever done.
 * - `wouldReject` — log it, marked, and continue. THE POINT OF THIS TYPE: in
 *   monitor mode an enforced endpoint with a non-`valid` token emits the exact
 *   counter the flip decision needs ("how many real requests would enforcement
 *   have broken?"), which is the beta telemetry `P8-SEC-02` is blocked on and
 *   which did not exist before. Turning the flip on without this number first
 *   is guessing.
 * - `rejected` — refuse the request.
 */
export type AppCheckOutcome = 'observed' | 'wouldReject' | 'rejected';

export interface AppCheckDecisionInput {
  readonly mode: AppCheckEnforcementMode;
  readonly classification: AppCheckClassification;
  readonly method: string;
  readonly routeUrl: string | undefined;
}

/**
 * The whole enforcement rule, in one pure function so both modes are testable
 * without a server.
 *
 * `missing` and `invalid` are treated identically: the point of attestation is
 * that the caller proves it is a real app instance, and "did not try" proves no
 * more than "tried and failed". Distinguishing them here would create a trivial
 * bypass — omit the header.
 */
export function decideAppCheckOutcome(input: AppCheckDecisionInput): AppCheckOutcome {
  if (input.classification === 'valid') {
    return 'observed';
  }
  if (!isEnforcedEndpoint(input.method, input.routeUrl)) {
    return 'observed';
  }
  return input.mode === 'enforce' ? 'rejected' : 'wouldReject';
}
