import type { PlantCandidate, SuitabilityAssessment } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createCandidateGateway } from './candidate-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
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
  return { gateway: createCandidateGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersOf(recorded: RecordedRequest): Record<string, string> {
  return recorded.init.headers as Record<string, string>;
}

const CANDIDATE: PlantCandidate = {
  id: CANDIDATE_ID,
  gardenId: GARDEN_ID,
  proposedGardenAreaMapObjectId: null,
  proposedPlacementMapObjectId: null,
  displayName: 'Fig tree',
  taxonomyReferenceId: null,
  varietyLabel: null,
  groupingKind: 'individual',
  quantity: null,
  status: 'active',
  rationaleNote: null,
  priority: 'medium',
  priceAmount: null,
  priceCurrency: null,
  purchaseSource: null,
  alternativeToCandidateId: null,
  photoAnalysis: null,
  revision: 1,
  createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const SUITABILITY: SuitabilityAssessment = {
  candidateId: CANDIDATE_ID,
  findings: [{ category: 'unknown', axis: 'hardiness', reason: 'plant_fact_missing' }],
};

describe('createCandidateGateway', () => {
  it('posts the request body and idempotency key on add', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(CANDIDATE, 201));

    await gateway.add(
      GARDEN_ID,
      { displayName: 'Fig tree', groupingKind: 'individual' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      displayName: 'Fig tree',
      groupingKind: 'individual',
    });
  });

  it('lists candidates with no parameters against the bare collection path', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [CANDIDATE] }, 200));

    const result = await gateway.list(GARDEN_ID, {});

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: { items: [CANDIDATE] } }));
  });

  it('encodes the free-text query, comma-joined structured filters, identified, cursor, and limit', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [] }, 200));

    await gateway.list(GARDEN_ID, {
      query: 'fig',
      status: ['active', 'archived'],
      priority: ['high'],
      identified: true,
      cursor: 'opaque-cursor',
      limit: 25,
    });

    const url = new URL(recorded[0]?.url ?? '');
    expect(url.pathname).toBe(`/v1/gardens/${GARDEN_ID}/plant-candidates`);
    expect(url.searchParams.get('query')).toBe('fig');
    expect(url.searchParams.get('status')).toBe('active,archived');
    expect(url.searchParams.get('priority')).toBe('high');
    expect(url.searchParams.get('identified')).toBe('true');
    expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('omits empty-array filters and a blank query rather than sending empty parameters', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [] }, 200));

    await gateway.list(GARDEN_ID, { query: '', status: [], priority: null, identified: null });

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates`);
  });

  it('gets a candidate by id', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(CANDIDATE, 200));

    const result = await gateway.get(GARDEN_ID, CANDIDATE_ID);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}`,
    );
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: CANDIDATE }));
  });

  it('sends the quoted revision as If-Match and the idempotency key on updateDetails', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(CANDIDATE, 200));

    await gateway.updateDetails(
      GARDEN_ID,
      CANDIDATE_ID,
      { displayName: 'Renamed' },
      3,
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.init.method).toBe('PATCH');
    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}`,
    );
    expect(headersOf(recorded[0]!)['if-match']).toBe('"3"');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
  });

  it('sends the quoted revision and idempotency key on setStatus', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(CANDIDATE, 200));

    await gateway.setStatus(GARDEN_ID, CANDIDATE_ID, { status: 'rejected' }, 2, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}/status`,
    );
    expect(headersOf(recorded[0]!)['if-match']).toBe('"2"');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ status: 'rejected' });
  });

  it('re-identifies from the primary photo with concurrency and idempotency guards', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(CANDIDATE, 200));

    await gateway.identifyFromPhoto(GARDEN_ID, CANDIDATE_ID, 4, IDEMPOTENCY_KEY);

    expect(recorded[0]?.init.method).toBe('POST');
    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}/identify`,
    );
    expect(headersOf(recorded[0]!)['if-match']).toBe('"4"');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
  });

  it('posts to the convert sub-resource with the quoted revision and idempotency key', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse(
        {
          plant: { ...CANDIDATE, id: CANDIDATE_ID },
          candidate: { ...CANDIDATE, status: 'converted' },
          conversion: {
            id: CANDIDATE_ID,
            candidateId: CANDIDATE_ID,
            plantId: CANDIDATE_ID,
            convertedByProfileId: CANDIDATE_ID,
            convertedAt: CANDIDATE.createdAt,
          },
        },
        201,
      ),
    );

    await gateway.convert(GARDEN_ID, CANDIDATE_ID, {}, 1, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}/convert`,
    );
    expect(headersOf(recorded[0]!)['if-match']).toBe('"1"');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
  });

  it('gets the latest suitability assessment', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(SUITABILITY, 200));

    const result = await gateway.getSuitability(GARDEN_ID, CANDIDATE_ID);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}/suitability`,
    );
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: SUITABILITY }));
  });

  it('recalculates suitability with no Idempotency-Key header', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(SUITABILITY, 201));

    await gateway.recalculateSuitability(GARDEN_ID, CANDIDATE_ID);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plant-candidates/${CANDIDATE_ID}/suitability`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBeUndefined();
  });
});
