/**
 * The App Check enforcement switch, exercised through the REAL composition
 * root rather than a bare Fastify instance.
 *
 * `app-check-plugin.test.ts` proves the hook. This file proves the wiring, and
 * the wiring is where the interesting mistakes live: that the default really
 * is off for the whole service, that the mode reaches all three
 * `registerAppCheck` registrations, that enforcement fires BEFORE
 * authentication (so a refusal cannot disclose anything), and that flipping it
 * on does not quietly break health checks, sign-out, or the worker callbacks.
 *
 * Every application here is built with `stubAppCheckVerifier`, which
 * classifies everything as `'missing'` — the worst case, and the one every
 * unattested caller produces.
 *
 * Source: docs/implementation-plan.md, work package `P8-SEC-02`;
 * docs/development/threat-model.md, section 13 (`T-COST-02`, `T-COST-10`).
 */

import type { ApiError } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CHECK_ENFORCED_ENDPOINTS } from '../../src/platform/app-check/app-check-enforcement.js';
import { APP_CHECK_REJECTED_CODE } from '../../src/platform/app-check/app-check-plugin.js';
import type { ApplicationConfiguration } from '../../src/platform/configuration/configuration-schema.js';
import { buildTestApplication, testConfiguration } from '../support/application.js';

const ENFORCING: ApplicationConfiguration = {
  ...testConfiguration,
  appCheck: { enforcement: 'enforce' },
};

/**
 * Concrete paths for the enforced endpoints. The ids are deliberately
 * syntactic nonsense: enforcement must fire before anything looks them up, so
 * no real garden or export ever needs to exist for these tests.
 */
const ENFORCED_REQUESTS: readonly { method: 'GET' | 'POST'; url: string }[] = [
  { method: 'POST', url: '/v1/auth/session' },
  { method: 'POST', url: '/v1/gardens/does-not-exist/media' },
  { method: 'POST', url: '/v1/gardens/does-not-exist/media/nope/complete' },
  { method: 'POST', url: '/v1/exports' },
  { method: 'GET', url: '/v1/gardens/does-not-exist/today' },
];

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('the default position of the switch', () => {
  it('is monitor, so no enforced endpoint answers 403 for a missing token', async () => {
    app = await buildTestApplication();

    for (const request of ENFORCED_REQUESTS) {
      const response = await app.inject(request);

      // Each of these still fails — they are unauthenticated calls with no
      // body — but they must fail for their OWN reason, never for App Check.
      expect(response.statusCode).not.toBe(403);
    }
  });

  it('leaves the unattested session request failing on its body, not on attestation', async () => {
    app = await buildTestApplication();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.code).toBe('request.invalid');
  });
});

describe('the enforce position of the switch', () => {
  it('refuses every enforced endpoint when no App Check token is present', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    for (const request of ENFORCED_REQUESTS) {
      const response = await app.inject(request);

      expect(response.statusCode).toBe(403);
      expect(response.json<ApiError>().error.code).toBe(APP_CHECK_REJECTED_CODE);
    }
  });

  it('covers exactly as many endpoints as the reviewed list names', () => {
    expect(ENFORCED_REQUESTS).toHaveLength(APP_CHECK_ENFORCED_ENDPOINTS.length);
  });

  it('refuses BEFORE authentication, so the refusal discloses nothing', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    // `stubTokenVerifier` rejects every call, so if authentication ran first
    // this would surface as a 500 or a 401 from the token verifier. A 403
    // with the App Check code proves the hook fired first and that no
    // credential was verified, no profile provisioned, and no garden read.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      payload: { idToken: 'a-syntactically-fine-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe(APP_CHECK_REJECTED_CODE);
  });

  it('answers identically for a garden that exists and one that does not', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    const [first, second] = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/gardens/00000000-0000-4000-8000-000000000000/today' }),
      app.inject({ method: 'GET', url: '/v1/gardens/not-even-a-uuid/today' }),
    ]);

    expect(first.statusCode).toBe(403);
    expect(second.statusCode).toBe(403);
    expect(first.json<ApiError>().error.code).toBe(second.json<ApiError>().error.code);
  });

  it('uses a code distinct from ordinary authorization failure', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    const response = await app.inject({ method: 'POST', url: '/v1/exports' });

    expect(response.json<ApiError>().error.code).toBe('request.app_check_rejected');
    expect(response.json<ApiError>().error.code).not.toBe('auth.forbidden');
  });
});

describe('what the enforce position must NOT break', () => {
  it('leaves the health endpoints reachable', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    for (const url of ['/v1/health/live', '/v1/health/ready']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
    }
  });

  it('leaves sign-out reachable: a broken attestation must not trap a session open', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    const response = await app.inject({ method: 'DELETE', url: '/v1/auth/session' });

    expect(response.statusCode).toBe(204);
  });

  it('leaves the worker callbacks reachable: Cloud Tasks carries OIDC, not App Check', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/media-retention/sweep',
    });

    // It still fails — the OIDC verifier stub rejects — but not with the App
    // Check code. Enforcing App Check on a worker route would break every
    // sweep in the product, since no worker can ever mint an App Check token.
    expect(response.json<ApiError>().error.code).not.toBe(APP_CHECK_REJECTED_CODE);
  });

  it('leaves ordinary authenticated routes on their own authentication failure', async () => {
    app = await buildTestApplication({ configuration: ENFORCING });

    const response = await app.inject({ method: 'GET', url: '/v1/gardens' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ApiError>().error.code).toBe('auth.unauthenticated');
  });
});
