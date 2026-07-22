/**
 * Request pipeline behavior: correlation, error envelopes, and leak protection.
 *
 * Source: architecture/backend-modular-monolith.md, section "11. Request Pipeline";
 *         architecture/api-design.md, section "12. Error Contract".
 */

import type { ApiError } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { CORRELATION_ID_HEADER } from '../../src/platform/telemetry/correlation.js';
import { buildTestApplication } from '../support/application.js';

const INTERNAL_DETAIL = 'connection to 10.0.0.1 refused for user verdery_application';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function buildApplicationWithFailingRoute(
  onLogRecord?: (record: string) => void,
): Promise<FastifyInstance> {
  const instance = await buildTestApplication(onLogRecord === undefined ? {} : { onLogRecord });

  instance.get('/v1/internal-failure', () => {
    throw new Error(INTERNAL_DETAIL);
  });

  await instance.ready();

  return instance;
}

describe('correlation', () => {
  it('echoes a client-supplied correlation identifier', async () => {
    app = await buildTestApplication();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/health/live',
      headers: { [CORRELATION_ID_HEADER]: 'workflow-42' },
    });

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('workflow-42');
  });

  it('generates an identifier when the client supplies none', async () => {
    app = await buildTestApplication();

    const response = await app.inject({ method: 'GET', url: '/v1/health/live' });

    expect(response.headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces an unusable identifier rather than logging attacker-controlled text', async () => {
    app = await buildTestApplication();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/health/live',
      headers: { [CORRELATION_ID_HEADER]: 'not valid\n{"level":50}' },
    });

    expect(response.headers[CORRELATION_ID_HEADER]).not.toContain('level');
  });

  it('puts the correlation identifier into the structured log records of the request', async () => {
    const records: string[] = [];
    app = await buildApplicationWithFailingRoute((record) => records.push(record));

    await app.inject({
      method: 'GET',
      url: '/v1/internal-failure',
      headers: { [CORRELATION_ID_HEADER]: 'workflow-7' },
    });

    const failureRecord = records.find((record) => record.includes('request.unexpected_failure'));

    expect(failureRecord).toBeDefined();
    expect(JSON.parse(failureRecord ?? '{}')).toMatchObject({
      correlationId: 'workflow-7',
      service: 'verdery-api-test',
    });
  });
});

describe('error envelope', () => {
  it('turns an unexpected exception into server.internal without leaking internals', async () => {
    app = await buildApplicationWithFailingRoute();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/internal-failure',
      headers: { [CORRELATION_ID_HEADER]: 'workflow-9' },
    });
    const body = response.json<ApiError>();

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('server.internal');
    expect(body.error.correlationId).toBe('workflow-9');
    expect(response.payload).not.toContain(INTERNAL_DETAIL);
  });

  it('answers an unknown route with the contract envelope rather than the framework default', async () => {
    app = await buildTestApplication();

    const response = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    const body = response.json<ApiError>();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('request.route_not_found');
    expect(body.error.retryable).toBe(false);
  });

  it('rejects a body larger than the configured limit as request.too_large', async () => {
    app = await buildTestApplication();
    app.post('/v1/oversized', () => ({ accepted: true }));
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/oversized',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(2_000_000) }),
    });
    const body = response.json<ApiError>();

    expect(response.statusCode).toBe(413);
    expect(body.error.code).toBe('request.too_large');
  });
});
