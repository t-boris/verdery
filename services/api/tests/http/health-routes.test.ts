/**
 * Health endpoint behavior against the contract.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `getLiveness` and
 * `getReadiness`.
 */

import type { LivenessResult, ReadinessResult } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApplication, TEST_SERVICE_VERSION } from '../support/application.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /v1/health/live', () => {
  it('reports the process as alive without touching dependencies', async () => {
    let pinged = false;
    app = await buildTestApplication({
      ping: () => {
        pinged = true;
        return Promise.reject(new Error('the database is down'));
      },
    });

    const response = await app.inject({ method: 'GET', url: '/v1/health/live' });
    const body = response.json<LivenessResult>();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: 'alive', version: TEST_SERVICE_VERSION });
    expect(pinged).toBe(false);
  });
});

describe('GET /v1/health/ready', () => {
  it('reports the service as ready when the database answers', async () => {
    app = await buildTestApplication();

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    const body = response.json<ReadinessResult>();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.version).toBe(TEST_SERVICE_VERSION);
    expect(body.dependencies).toEqual([{ name: 'database', status: 'available' }]);
  });

  it('returns 503 with the failing dependency when the database is unavailable', async () => {
    app = await buildTestApplication({
      ping: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    const body = response.json<ReadinessResult>();

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('notReady');
    expect(body.dependencies[0]?.status).toBe('unavailable');
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
  });
});
