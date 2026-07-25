/* global __ENV, __VU, open */
/**
 * Credential handling for authenticated load scenarios.
 *
 * The API accepts two credentials (`platform/authentication/authentication-plugin.ts`):
 * an `Authorization: Bearer <Firebase ID token>` header, or a Firebase session
 * cookie plus a double-submit CSRF header. This harness uses the bearer form
 * only — it is the native client's path, it needs no cookie jar, and it avoids
 * exercising `POST /v1/auth/session`, which is the single most expensive
 * unauthenticated endpoint in the product (threat-model.md `T-COST-02`) and
 * must not be turned into load-generator background noise.
 *
 * Tokens are supplied from OUTSIDE this harness, never minted by it. A Firebase
 * ID token lives one hour, so a long run needs pre-minted tokens refreshed
 * between runs, or a short run. Two ways in:
 *
 *   VERDERY_ID_TOKENS      "tokenA,tokenB,tokenC"
 *   VERDERY_ID_TOKEN_FILE  path to a JSON array: ["tokenA", "tokenB"]
 *
 * How to obtain them is documented in docs/development/load-testing.md §4 —
 * against the Firebase Auth emulator for a local run, and via the Identity
 * Toolkit REST API for a real project.
 */

import { envList } from './config.mjs';

/**
 * Reads the token pool. Init context only: `open()` is unavailable inside a VU
 * iteration, which is exactly the constraint that keeps credential reads out of
 * the measured path.
 */
export function loadTokens() {
  const inline = envList('VERDERY_ID_TOKENS');
  if (inline.length > 0) {
    return inline;
  }

  const path = __ENV.VERDERY_ID_TOKEN_FILE;
  if (path === undefined || path === '') {
    return [];
  }

  const parsed = JSON.parse(open(path));
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON array of Firebase ID tokens.`);
  }
  return parsed.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

/**
 * Assigns a stable token to each virtual user, so one VU behaves like one
 * device rather than like a randomly rotating identity — which matters for
 * per-profile rate limits, sync installation identity, and idempotency.
 */
export function tokenForVu(tokens) {
  if (tokens.length === 0) {
    return null;
  }
  return tokens[(__VU - 1) % tokens.length];
}

/** Request headers for an authenticated call. `extra` wins on conflict. */
export function authHeaders(token, extra) {
  return Object.assign(
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    extra ?? {},
  );
}

/**
 * Fails the run early and loudly when a scenario that needs credentials has
 * none, instead of measuring a wall of 401s and calling it a latency profile.
 */
export function requireTokens(tokens, scenarioName) {
  if (tokens.length === 0) {
    throw new Error(
      `${scenarioName} needs authenticated callers. Set VERDERY_ID_TOKENS or ` +
        'VERDERY_ID_TOKEN_FILE — see docs/development/load-testing.md section 4.',
    );
  }
}
