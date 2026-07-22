import type { Garden, GardenListResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { CSRF_HEADER_NAME } from './csrf';
import { createGardenGateway } from './garden-gateway';

const ORIGIN = 'https://api.example.test';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function gatewayRecording(response: Response) {
  const recorded: RecordedRequest[] = [];
  const fetchImplementation: FetchLike = (url, init) => {
    recorded.push({ url, init });
    return Promise.resolve(response);
  };

  const client = createApiClient({ origin: ORIGIN, fetchImplementation });
  return { gateway: createGardenGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function noContent(status: number): Response {
  return new Response(null, { status });
}

const GARDEN: Garden = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  name: 'Backyard',
  lifecycleState: 'active',
  callerRole: 'owner',
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

describe('createGardenGateway', () => {
  it('lists without a cursor', async () => {
    const list: GardenListResult = { items: [GARDEN] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    const result = await gateway.list(null);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: list }));
  });

  it('encodes a non-null cursor into the query string', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [] }, 200));

    await gateway.list('a cursor/with?chars');

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens?cursor=${encodeURIComponent('a cursor/with?chars')}`,
    );
  });

  it('sends the idempotency key header and the request body on create', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(GARDEN, 201));

    await gateway.create('Backyard', '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');

    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headers['idempotency-key']).toBe('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ name: 'Backyard' });
  });

  it('sends the quoted revision as If-Match and the idempotency key on rename', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(GARDEN, 200));

    await gateway.rename(GARDEN.id, 'Front Yard', 3, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');

    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(recorded[0]?.init.method).toBe('PATCH');
    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN.id}`);
    expect(headers['if-match']).toBe('"3"');
    expect(headers['idempotency-key']).toBe('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');
  });

  it('posts to the archive and delete-request sub-resources', async () => {
    const archive = gatewayRecording(jsonResponse(GARDEN, 200));
    await archive.gateway.archive(GARDEN.id, 1, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');
    expect(archive.recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN.id}/archive`);

    const deletion = gatewayRecording(jsonResponse(GARDEN, 200));
    await deletion.gateway.requestDeletion(GARDEN.id, 1, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');
    expect(deletion.recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN.id}/delete-request`);
  });

  it('never sends a CSRF header when no CSRF cookie is present', async () => {
    const { gateway, recorded } = gatewayRecording(noContent(204));

    await gateway.archive(GARDEN.id, 1, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c');

    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER_NAME]).toBeUndefined();
  });
});
