/**
 * Plugin-level tests.
 *
 * Monitor mode — the default, and every environment today — means the request
 * must never be blocked by App Check, whatever the verifier reports or does.
 * Enforce mode means exactly one thing more: an unattested request to an
 * endpoint on the reviewed list is refused, and nothing else changes.
 *
 * A minimal Fastify instance is built directly here, rather than through
 * `buildTestApplication`, so the assertions stay about this hook alone and
 * do not depend on the rest of the request pipeline.
 */

import { API_BASE_PATH, type ApiError } from '@verdery/api-contracts';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerErrorHandling } from '../errors/error-handler.js';
import type { AppCheckEnforcementMode } from './app-check-enforcement.js';
import { APP_CHECK_HEADER, APP_CHECK_REJECTED_CODE, registerAppCheck } from './app-check-plugin.js';
import type { AppCheckClassification, AppCheckVerifier } from './app-check-verifier.js';

function fakeVerifier(classify: AppCheckVerifier['classify']): AppCheckVerifier {
  return { classify };
}

/** A logger spy satisfying `FastifyBaseLogger`; `child` returns itself so nested calls are still captured. */
function spyLogger(): FastifyBaseLogger & { info: ReturnType<typeof vi.fn> } {
  const logger = {
    level: 'info',
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: () => logger,
  };
  return logger as FastifyBaseLogger & { info: ReturnType<typeof vi.fn> };
}

async function buildPluginTestApplication(
  appCheckVerifier: AppCheckVerifier,
  logger: FastifyBaseLogger,
  enforcementMode?: AppCheckEnforcementMode,
) {
  const app = Fastify({ loggerInstance: logger });
  // The real error handler, and only it: a typed `ForbiddenError` maps to 403
  // there and nowhere else, so asserting a status code here would otherwise
  // be asserting Fastify's 500 fallback rather than this plugin's behavior.
  registerErrorHandling(app);
  registerAppCheck(app, {
    appCheckVerifier,
    ...(enforcementMode === undefined ? {} : { enforcementMode }),
  });
  app.get('/probe', () => ({ ok: true }));
  // Two real, registered enforced endpoints — the cheapest unauthenticated
  // one and a garden-scoped one — plus an unenforced sibling on the same
  // prefix, so the enforce-mode tests distinguish "this route" from "this
  // area of the API".
  app.post(`${API_BASE_PATH}/auth/session`, () => ({ ok: true }));
  app.get(`${API_BASE_PATH}/gardens/:gardenId/today`, () => ({ ok: true }));
  app.get(`${API_BASE_PATH}/gardens`, () => ({ ok: true }));
  await app.ready();
  return app;
}

/** Finds this plugin's own log record, ignoring Fastify's request/response lines. */
function classifiedRecord(logger: ReturnType<typeof spyLogger>): Record<string, unknown> {
  const call = logger.info.mock.calls.find(
    ([record]) =>
      typeof record === 'object' &&
      record !== null &&
      (record as { event?: unknown }).event === 'app_check.classified',
  );
  expect(call).toBeDefined();
  return (call as [Record<string, unknown>, string])[0];
}

describe('registerAppCheck', () => {
  it('lets the request succeed regardless of classification', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('valid')),
      logger,
    );

    const response = await app.inject({ method: 'GET', url: '/probe' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it('classifies a missing token as missing without calling the verifier', async () => {
    const logger = spyLogger();
    const classify = vi.fn(() => Promise.resolve<AppCheckClassification>('missing'));
    const app = await buildPluginTestApplication(fakeVerifier(classify), logger);

    await app.inject({ method: 'GET', url: '/probe' });

    expect(classify).toHaveBeenCalledWith(undefined);
    await app.close();
  });

  it('logs "invalid" when the verifier throws, without failing the request', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.reject(new Error('boom'))),
      logger,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { [APP_CHECK_HEADER]: 'some-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app_check.classified', classification: 'invalid' }),
      expect.any(String),
    );
    await app.close();
  });

  it('logs "valid" when the verifier resolves successfully', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('valid')),
      logger,
    );

    await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { [APP_CHECK_HEADER]: 'some-token' },
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app_check.classified', classification: 'valid' }),
      expect.any(String),
    );
    await app.close();
  });

  it('logs "missing" when no token header is present', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier((token) => Promise.resolve(token === undefined ? 'missing' : 'valid')),
      logger,
    );

    await app.inject({ method: 'GET', url: '/probe' });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app_check.classified', classification: 'missing' }),
      expect.any(String),
    );
    await app.close();
  });

  it('never logs the token value itself', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('valid')),
      logger,
    );

    await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { [APP_CHECK_HEADER]: 'super-secret-token-value' },
    });

    // Scoped to this plugin's own log call: Fastify's built-in incoming/completed
    // request logs also flow through `logger.info` and legitimately include raw
    // headers — that redaction is pino's job (see platform/telemetry/logger.ts,
    // which already redacts `req.headers["x-firebase-appcheck"]`), not this hook's.
    const classifiedCall = logger.info.mock.calls.find(
      ([record]) =>
        typeof record === 'object' &&
        record !== null &&
        (record as { event?: unknown }).event === 'app_check.classified',
    );

    expect(classifiedCall).toBeDefined();
    expect(JSON.stringify(classifiedCall)).not.toContain('super-secret-token-value');
    await app.close();
  });
});

describe('registerAppCheck — the enforcement switch', () => {
  it('defaults to monitor when no mode is supplied', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('missing')),
      logger,
    );

    const response = await app.inject({ method: 'POST', url: `${API_BASE_PATH}/auth/session` });

    expect(response.statusCode).toBe(200);
    expect(classifiedRecord(logger)['mode']).toBe('monitor');
    await app.close();
  });

  it('logs outcome "wouldReject" in monitor mode on an enforced endpoint', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('missing')),
      logger,
      'monitor',
    );

    const response = await app.inject({ method: 'POST', url: `${API_BASE_PATH}/auth/session` });

    // The whole point: the request SUCCEEDS, and the log line still says
    // enforcement would have refused it. That is the counter the flip
    // decision has been waiting on.
    expect(response.statusCode).toBe(200);
    expect(classifiedRecord(logger)).toMatchObject({
      enforced: true,
      mode: 'monitor',
      outcome: 'wouldReject',
      classification: 'missing',
    });
    await app.close();
  });

  it('logs outcome "observed" in monitor mode on an unenforced endpoint', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('missing')),
      logger,
      'monitor',
    );

    await app.inject({ method: 'GET', url: `${API_BASE_PATH}/gardens` });

    expect(classifiedRecord(logger)).toMatchObject({ enforced: false, outcome: 'observed' });
    await app.close();
  });

  it('rejects an unattested request to an enforced endpoint in enforce mode', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('missing')),
      logger,
      'enforce',
    );

    const response = await app.inject({ method: 'POST', url: `${API_BASE_PATH}/auth/session` });

    expect(response.statusCode).toBe(403);
    expect(classifiedRecord(logger)).toMatchObject({ mode: 'enforce', outcome: 'rejected' });
    await app.close();
  });

  it('rejects an INVALID token exactly as it rejects a missing one', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('invalid')),
      logger,
      'enforce',
    );

    const response = await app.inject({
      method: 'GET',
      url: `${API_BASE_PATH}/gardens/g-1/today`,
      headers: { [APP_CHECK_HEADER]: 'a-token-that-does-not-verify' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('admits a valid token to an enforced endpoint in enforce mode', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('valid')),
      logger,
      'enforce',
    );

    const response = await app.inject({
      method: 'GET',
      url: `${API_BASE_PATH}/gardens/g-1/today`,
      headers: { [APP_CHECK_HEADER]: 'a-good-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(classifiedRecord(logger)).toMatchObject({ mode: 'enforce', outcome: 'observed' });
    await app.close();
  });

  it('leaves UNENFORCED endpoints reachable without a token even in enforce mode', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('missing')),
      logger,
      'enforce',
    );

    const response = await app.inject({ method: 'GET', url: `${API_BASE_PATH}/gardens` });

    // Enforcement is scoped, not global: one misconfigured client degrades
    // the expensive endpoints, it does not take the product down.
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('fails closed when the verifier itself throws, in enforce mode only', async () => {
    const throwingVerifier = fakeVerifier(() => Promise.reject(new Error('boom')));

    const enforcing = await buildPluginTestApplication(throwingVerifier, spyLogger(), 'enforce');
    const enforced = await enforcing.inject({
      method: 'POST',
      url: `${API_BASE_PATH}/auth/session`,
      headers: { [APP_CHECK_HEADER]: 'some-token' },
    });
    expect(enforced.statusCode).toBe(403);
    await enforcing.close();

    const monitoring = await buildPluginTestApplication(throwingVerifier, spyLogger(), 'monitor');
    const monitored = await monitoring.inject({
      method: 'POST',
      url: `${API_BASE_PATH}/auth/session`,
      headers: { [APP_CHECK_HEADER]: 'some-token' },
    });
    expect(monitored.statusCode).toBe(200);
    await monitoring.close();
  });

  it('rejects with a code distinct from ordinary authorization failure', async () => {
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('missing')),
      spyLogger(),
      'enforce',
    );

    const response = await app.inject({ method: 'POST', url: `${API_BASE_PATH}/auth/session` });

    // NOT `auth.forbidden`: an operator watching a flip must be able to
    // separate "unattested client" from "unauthorized user", and a client
    // must be able to separate "refresh your token and retry" from "stop
    // asking". One shared code would collapse both.
    const body = response.json<ApiError>();
    expect(body.error.code).toBe(APP_CHECK_REJECTED_CODE);
    expect(body.error.code).not.toBe('auth.forbidden');
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('still never logs the token value when it rejects', async () => {
    const logger = spyLogger();
    const app = await buildPluginTestApplication(
      fakeVerifier(() => Promise.resolve('invalid')),
      logger,
      'enforce',
    );

    await app.inject({
      method: 'POST',
      url: `${API_BASE_PATH}/auth/session`,
      headers: { [APP_CHECK_HEADER]: 'super-secret-token-value' },
    });

    expect(JSON.stringify(classifiedRecord(logger))).not.toContain('super-secret-token-value');
    await app.close();
  });
});
