import type { GardenContextFact, GardenContextFactListResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createGardenContextGateway } from './garden-context-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

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
  return { gateway: createGardenContextGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FACT: GardenContextFact = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  gardenId: GARDEN_ID,
  contextKind: 'sun_exposure',
  value: 'full_sun',
  source: 'user_declared',
  recordedByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
  recordedAt: '2026-07-21T09:00:00Z',
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

describe('createGardenContextGateway', () => {
  it('lists every context fact for a garden', async () => {
    const list: GardenContextFactListResult = { items: [FACT] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    const result = await gateway.list(GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/context`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: list }));
  });

  it('records a fact with a PUT to the contextKind path, carrying no idempotency key or If-Match', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(FACT, 200));

    const result = await gateway.record(GARDEN_ID, 'sun_exposure', {
      value: 'full_sun',
      source: 'user_declared',
    });

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/context/sun_exposure`);
    expect(recorded[0]?.init.method).toBe('PUT');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      value: 'full_sun',
      source: 'user_declared',
    });
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
    expect(headers['if-match']).toBeUndefined();
    expect(result).toEqual(expect.objectContaining({ ok: true, data: FACT }));
  });

  it('carries reviewedBy/reviewedOn in the body when supplied', async () => {
    const reviewed: GardenContextFact = {
      ...FACT,
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Horticulture Team',
      reviewedOn: '2026-06-01',
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(reviewed, 200));

    await gateway.record(GARDEN_ID, 'sun_exposure', {
      value: 'full_sun',
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Horticulture Team',
      reviewedOn: '2026-06-01',
    });

    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      value: 'full_sun',
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Horticulture Team',
      reviewedOn: '2026-06-01',
    });
  });
});
