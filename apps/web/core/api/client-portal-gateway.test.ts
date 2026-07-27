import type { ClientAccessGrant, ClientGardenOverview } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createClientPortalGateway } from './client-portal-gateway';

const ORIGIN = 'https://api.example.test';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const CLIENT_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01';
const PUBLICATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c02';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c03';

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
  return { gateway: createClientPortalGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OVERVIEW: ClientGardenOverview = {
  clientGardenId: CLIENT_GARDEN_ID,
};

const GRANT: ClientAccessGrant = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c04',
  engagementId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c05',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
};

describe('createClientPortalGateway — reads', () => {
  it('lists the caller’s own client gardens with no path or query parameter', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ items: [{ id: CLIENT_GARDEN_ID, name: 'Riverside Garden' }] }, 200),
    );

    const result = await gateway.listClientGardens();

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client/gardens`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        data: { items: [{ id: CLIENT_GARDEN_ID, name: 'Riverside Garden' }] },
      }),
    );
  });

  it('gets a client garden overview, honestly empty when no snapshot has ever been published', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(OVERVIEW, 200));

    const result = await gateway.getClientGardenOverview(CLIENT_GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client/gardens/${CLIENT_GARDEN_ID}/overview`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: OVERVIEW }));
  });

  it('lists a client garden’s publications, newest first', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [] }, 200));

    await gateway.listClientPublications(CLIENT_GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client/gardens/${CLIENT_GARDEN_ID}/publications`);
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('gets a client garden’s factual timeline, oldest first', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [] }, 200));

    await gateway.getClientTimeline(CLIENT_GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client/gardens/${CLIENT_GARDEN_ID}/timeline`);
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('gets short-lived media access, scoped by publicationId and mediaId, with no idempotency key', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ url: 'https://signed.example/media', expiresAt: '2026-07-21T09:15:00Z' }, 200),
    );

    await gateway.getClientMediaAccess(PUBLICATION_ID, MEDIA_ID);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/client/publications/${PUBLICATION_ID}/media/${MEDIA_ID}/access`,
    );
    expect(recorded[0]?.init.method).toBe('GET');
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
  });
});

describe('createClientPortalGateway — invitation acceptance (tag ClientAccess)', () => {
  it('accepts a client invitation at the top-level, engagement-less path, with the idempotency key header', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(GRANT, 200));

    const result = await gateway.acceptClientInvitation('a-raw-opaque-token', IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client-invitations/accept`);
    expect(recorded[0]?.init.method).toBe('POST');
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ token: 'a-raw-opaque-token' });
    expect(result).toEqual(expect.objectContaining({ ok: true, data: GRANT }));
  });
});
