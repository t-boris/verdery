/**
 * Plugin-level tests: monitor-only means the request must never be blocked
 * by App Check, whatever the verifier reports or does.
 *
 * A minimal Fastify instance is built directly here, rather than through
 * `buildTestApplication`, so the assertions stay about this hook alone and
 * do not depend on the rest of the request pipeline.
 */

import Fastify, { type FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { APP_CHECK_HEADER, registerAppCheck } from './app-check-plugin.js';
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
) {
  const app = Fastify({ loggerInstance: logger });
  registerAppCheck(app, { appCheckVerifier });
  app.get('/probe', () => ({ ok: true }));
  await app.ready();
  return app;
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
