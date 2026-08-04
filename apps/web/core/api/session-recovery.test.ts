import { SharedErrorCode } from '@verdery/api-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient, RequestSpec } from './client';
import type { ApiResult } from './result';
import { withSessionRecovery } from './session-recovery';

const CORRELATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

function unauthenticated(): ApiResult<never> {
  return {
    ok: false,
    kind: 'contract',
    code: SharedErrorCode.Unauthenticated,
    fallbackMessage: 'This request requires a Firebase ID token or an active session.',
    correlationId: CORRELATION_ID,
    retryable: false,
    details: [],
    status: 401,
  };
}

function forbidden(): ApiResult<never> {
  return {
    ok: false,
    kind: 'contract',
    code: 'auth.forbidden',
    fallbackMessage: 'Not permitted.',
    correlationId: CORRELATION_ID,
    retryable: false,
    details: [],
    status: 403,
  };
}

function ok(value: string): ApiResult<string> {
  return { ok: true, status: 200, correlationId: CORRELATION_ID, data: value };
}

/** A client that answers with the queued results in order, recording every spec it was given. */
function clientAnswering(results: ApiResult<string>[]): {
  readonly client: ApiClient;
  readonly specs: RequestSpec[];
} {
  const specs: RequestSpec[] = [];
  const queue = [...results];

  return {
    specs,
    client: {
      request: <TData>(spec: RequestSpec): Promise<ApiResult<TData>> => {
        specs.push(spec);
        return Promise.resolve(queue.shift() as ApiResult<TData>);
      },
    },
  };
}

const SPEC: RequestSpec = { method: 'GET', path: '/gardens' };

describe('withSessionRecovery', () => {
  it('passes a successful result through untouched', async () => {
    const { client, specs } = clientAnswering([ok('gardens')]);
    const recover = vi.fn();
    const recovering = withSessionRecovery(client, { recover, abandon: vi.fn() });

    await expect(recovering.request(SPEC)).resolves.toEqual(ok('gardens'));
    expect(specs).toHaveLength(1);
    expect(recover).not.toHaveBeenCalled();
  });

  it('replays the request once after a successful refresh', async () => {
    const { client, specs } = clientAnswering([unauthenticated(), ok('gardens')]);
    const abandon = vi.fn();
    const recovering = withSessionRecovery(client, {
      recover: () => Promise.resolve(true),
      abandon,
    });

    await expect(recovering.request(SPEC)).resolves.toEqual(ok('gardens'));
    expect(specs).toEqual([SPEC, SPEC]);
    expect(abandon).not.toHaveBeenCalled();
  });

  it('abandons the session when no credential can be refreshed', async () => {
    const { client, specs } = clientAnswering([unauthenticated()]);
    const abandon = vi.fn();
    const recovering = withSessionRecovery(client, {
      recover: () => Promise.resolve(false),
      abandon,
    });

    const result = await recovering.request(SPEC);

    expect(result.ok).toBe(false);
    expect(specs).toHaveLength(1);
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('abandons rather than looping when the replay is unauthenticated too', async () => {
    const { client, specs } = clientAnswering([unauthenticated(), unauthenticated()]);
    const abandon = vi.fn();
    const recovering = withSessionRecovery(client, {
      recover: () => Promise.resolve(true),
      abandon,
    });

    await recovering.request(SPEC);

    expect(specs).toHaveLength(2);
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  // An expired cookie fails every query on the screen at once. One session is
  // minted, not one per failed request.
  it('shares one recovery between concurrent failures', async () => {
    const queue: ApiResult<string>[] = [
      unauthenticated(),
      unauthenticated(),
      ok('first'),
      ok('second'),
    ];
    const client: ApiClient = {
      request: <TData>(): Promise<ApiResult<TData>> =>
        Promise.resolve(queue.shift() as ApiResult<TData>),
    };
    const recover = vi.fn(() => Promise.resolve(true));
    const recovering = withSessionRecovery(client, { recover, abandon: vi.fn() });

    const results = await Promise.all([recovering.request(SPEC), recovering.request(SPEC)]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('leaves an authorization failure alone', async () => {
    const { client } = clientAnswering([forbidden()]);
    const recover = vi.fn();
    const abandon = vi.fn();
    const recovering = withSessionRecovery(client, { recover, abandon });

    await recovering.request(SPEC);

    expect(recover).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it('recovers again after an earlier recovery has finished', async () => {
    const { client } = clientAnswering([
      unauthenticated(),
      ok('first'),
      unauthenticated(),
      ok('second'),
    ]);
    const recover = vi.fn(() => Promise.resolve(true));
    const recovering = withSessionRecovery(client, { recover, abandon: vi.fn() });

    await recovering.request(SPEC);
    await recovering.request(SPEC);

    expect(recover).toHaveBeenCalledTimes(2);
  });
});
