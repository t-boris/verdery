import type { Plant, TaxonomyReferenceListResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createPlantGateway } from './plant-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';

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
  return { gateway: createPlantGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PLANT: Plant = {
  id: PLANT_ID,
  gardenId: GARDEN_ID,
  gardenAreaMapObjectId: null,
  placementMapObjectId: null,
  displayName: 'Tomato row',
  taxonomyReferenceId: null,
  varietyLabel: null,
  acceptedIdentificationId: null,
  acquisitionDate: null,
  acquisitionDateType: null,
  groupingKind: 'individual',
  quantity: null,
  lifecycleStage: 'seed',
  status: 'active',
  conditionNote: null,
  careGuidanceNote: null,
  revision: 1,
  createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function headersOf(recorded: RecordedRequest): Record<string, string> {
  return recorded.init.headers as Record<string, string>;
}

describe('createPlantGateway', () => {
  it('posts the request body and idempotency key on add', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 201));

    await gateway.add(
      GARDEN_ID,
      { displayName: 'Tomato row', groupingKind: 'individual' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      displayName: 'Tomato row',
      groupingKind: 'individual',
    });
  });

  it('posts to the from-photo sub-resource', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 201));

    await gateway.addFromPhoto(GARDEN_ID, { photoMediaId: PLANT_ID }, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/from-photo`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('gets a plant by id', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 200));

    const result = await gateway.get(GARDEN_ID, PLANT_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: PLANT }));
  });

  it('sends the quoted revision as If-Match and the idempotency key on updateDetails', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 200));

    await gateway.updateDetails(
      GARDEN_ID,
      PLANT_ID,
      { displayName: 'Renamed' },
      3,
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.init.method).toBe('PATCH');
    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}`);
    expect(headersOf(recorded[0]!)['if-match']).toBe('"3"');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
  });

  it('posts to the photos sub-resource without an If-Match header', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse(
        {
          id: PLANT_ID,
          plantId: PLANT_ID,
          mediaId: PLANT_ID,
          isPrimary: false,
          createdAt: PLANT.createdAt,
        },
        201,
      ),
    );

    await gateway.attachPhoto(
      GARDEN_ID,
      PLANT_ID,
      { mediaId: PLANT_ID, isPrimary: false },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/photos`);
    expect(headersOf(recorded[0]!)['if-match']).toBeUndefined();
  });

  it('posts to the primary-photo sub-resource', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse(
        {
          id: PLANT_ID,
          plantId: PLANT_ID,
          mediaId: PLANT_ID,
          isPrimary: true,
          createdAt: PLANT.createdAt,
        },
        200,
      ),
    );

    await gateway.setPrimaryPhoto(GARDEN_ID, PLANT_ID, PLANT_ID, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/photos/${PLANT_ID}/primary`,
    );
  });

  it('sends the quoted revision on confirmIdentification', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 200));

    await gateway.confirmIdentification(GARDEN_ID, PLANT_ID, PLANT_ID, 2, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/identification/${PLANT_ID}/confirm`,
    );
    expect(headersOf(recorded[0]!)['if-match']).toBe('"2"');
  });

  it('sends the stage in the body on transitionLifecycleStage', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 200));

    await gateway.transitionLifecycleStage(GARDEN_ID, PLANT_ID, 'flowering', 4, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/lifecycle-stage`,
    );
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ stage: 'flowering' });
    expect(headersOf(recorded[0]!)['if-match']).toBe('"4"');
  });

  it('sends the status in the body on setStatus', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 200));

    await gateway.setStatus(GARDEN_ID, PLANT_ID, 'removed', 5, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/status`);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ status: 'removed' });
  });

  it('posts the placement fields on move', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PLANT, 200));

    await gateway.move(GARDEN_ID, PLANT_ID, { placementMapObjectId: PLANT_ID }, 6, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/move`);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      placementMapObjectId: PLANT_ID,
    });
  });

  it('omits the query string when query and limit are both null', async () => {
    const list: TaxonomyReferenceListResult = { items: [] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    await gateway.searchTaxonomyReferences(GARDEN_ID, null, null);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/taxonomy-references`);
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('encodes query and limit into the query string when given', async () => {
    const list: TaxonomyReferenceListResult = { items: [] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    await gateway.searchTaxonomyReferences(GARDEN_ID, 'tomato basil', 10);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/taxonomy-references?${new URLSearchParams({ query: 'tomato basil', limit: '10' }).toString()}`,
    );
  });
});
