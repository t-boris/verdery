import { SharedErrorCode, type ApiError, type LivenessResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { CORRELATION_ID_HEADER } from './correlation';
import { errorMessageKey } from './error-message';
import { createHealthGateway } from './health-gateway';
import { ClientErrorCode } from './result';

const ORIGIN = 'https://api.example.test';
const FIXED_CORRELATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function clientReturning(
  response: Response | (() => Promise<Response>),
  recorded?: RecordedRequest[],
) {
  const fetchImplementation: FetchLike = (url, init) => {
    recorded?.push({ url, init });
    return typeof response === 'function' ? response() : Promise.resolve(response);
  };

  return createApiClient({
    origin: ORIGIN,
    fetchImplementation,
    createCorrelationId: () => FIXED_CORRELATION_ID,
  });
}

const LIVENESS: LivenessResult = { status: 'alive', version: '1.0.0' };

describe('createApiClient', () => {
  it('sends the correlation header and the version prefix, and returns typed data', async () => {
    const recorded: RecordedRequest[] = [];
    const client = clientReturning(jsonResponse(LIVENESS, 200), recorded);

    const result = await client.request<LivenessResult>({ method: 'GET', path: '/health/live' });

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/health/live`);
    expect((recorded[0]?.init.headers as Record<string, string>)[CORRELATION_ID_HEADER]).toBe(
      FIXED_CORRELATION_ID,
    );
    expect(recorded[0]?.init.credentials).toBe('include');
    expect(result).toEqual({
      ok: true,
      status: 200,
      correlationId: FIXED_CORRELATION_ID,
      data: LIVENESS,
    });
  });

  it('maps the contract error envelope into a typed failure', async () => {
    const envelope: ApiError = {
      error: {
        code: SharedErrorCode.StaleRevision,
        message: 'The garden object changed before this edit was saved.',
        correlationId: 'server-correlation-id',
        retryable: false,
        details: [{ code: 'revision.mismatch', pointer: '/revision' }],
      },
    };
    const client = clientReturning(jsonResponse(envelope, 409));

    const result = await client.request<LivenessResult>({ method: 'GET', path: '/health/live' });

    expect(result).toEqual({
      ok: false,
      kind: 'contract',
      code: SharedErrorCode.StaleRevision,
      fallbackMessage: envelope.error.message,
      // The server's identifier wins: it is the one recorded in telemetry.
      correlationId: 'server-correlation-id',
      retryable: false,
      details: [{ code: 'revision.mismatch', pointer: '/revision' }],
      status: 409,
    });
  });

  it('never throws when the request does not reach the server', async () => {
    const client = clientReturning(() => Promise.reject(new TypeError('Failed to fetch')));

    const result = await client.request<LivenessResult>({ method: 'GET', path: '/health/live' });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      kind: 'transport',
      code: ClientErrorCode.TransportFailure,
      correlationId: FIXED_CORRELATION_ID,
      retryable: true,
      status: null,
    });
  });

  it('reports an error response that is not the shared envelope as malformed', async () => {
    const client = clientReturning(new Response('<html>gateway timeout</html>', { status: 504 }));

    const result = await client.request<LivenessResult>({ method: 'GET', path: '/health/live' });

    expect(result).toMatchObject({
      ok: false,
      kind: 'malformed',
      code: ClientErrorCode.MalformedResponse,
      retryable: true,
      status: 504,
    });
  });

  it('reports a successful response with an unparsable body as malformed', async () => {
    const client = clientReturning(new Response('not json', { status: 200 }));

    const result = await client.request<LivenessResult>({ method: 'GET', path: '/health/live' });

    expect(result).toMatchObject({ ok: false, kind: 'malformed', status: 200 });
  });

  it('does not leak the fetch rejection value into the result', async () => {
    const client = clientReturning(() =>
      Promise.reject(new Error('connect ECONNREFUSED 10.0.0.4:8080')),
    );

    const result = await client.request<LivenessResult>({ method: 'GET', path: '/health/live' });

    expect(JSON.stringify(result)).not.toContain('10.0.0.4');
  });
});

describe('createHealthGateway', () => {
  it('treats a 503 readiness report as a successful read', async () => {
    const notReady = {
      status: 'notReady',
      version: '1.0.0',
      dependencies: [{ name: 'database', status: 'unavailable' }],
    };
    const gateway = createHealthGateway(clientReturning(jsonResponse(notReady, 503)));

    const result = await gateway.readReadiness();

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.status).toBe('notReady');
  });

  it('still reports a 500 on the readiness endpoint as a failure', async () => {
    const envelope: ApiError = {
      error: {
        code: SharedErrorCode.Internal,
        message: 'Unexpected internal failure.',
        correlationId: FIXED_CORRELATION_ID,
        retryable: true,
      },
    };
    const gateway = createHealthGateway(clientReturning(jsonResponse(envelope, 500)));

    const result = await gateway.readReadiness();

    expect(result).toMatchObject({ ok: false, kind: 'contract', code: SharedErrorCode.Internal });
  });
});

describe('errorMessageKey', () => {
  it('resolves every shared error code to a translated message', () => {
    for (const code of Object.values(SharedErrorCode)) {
      expect(errorMessageKey(code), code).not.toBe('error.unknown');
    }
  });

  it('falls back to the generic message for a module code the shell does not know', () => {
    expect(errorMessageKey('garden.geometry.self_intersecting')).toBe('error.unknown');
  });
});
