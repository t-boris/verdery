import type { SeasonalPlanResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createSeasonalPlanGateway } from './seasonal-plan-gateway';

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
  return { gateway: createSeasonalPlanGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PLAN: SeasonalPlanResult = {
  gardenId: GARDEN_ID,
  hemisphere: 'northern',
  plants: [],
  rotationStatus: [],
};

describe('createSeasonalPlanGateway', () => {
  it('reads the seasonal plan for a garden', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLAN, 200));

    const result = await gateway.get(GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/seasonal-plan`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: PLAN }));
  });
});
