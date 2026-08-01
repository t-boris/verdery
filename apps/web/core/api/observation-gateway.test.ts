import type {
  ImageAnalysisResult,
  Observation,
  ObservationListResult,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createObservationGateway } from './observation-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const OBSERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const ANALYSIS_RESULT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';

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
  return { gateway: createObservationGateway(client), recorded };
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

const OBSERVATION: Observation = {
  id: OBSERVATION_ID,
  gardenId: GARDEN_ID,
  plantId: null,
  gardenObjectId: null,
  actorType: 'user',
  createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
  noteText: 'Leaves looking healthy',
  conditionSummary: null,
  correctionKind: null,
  correctsObservationId: null,
  isCorrected: false,
  observedPhenologicalStage: null,
  observedSunExposure: null,
  observedDrainage: null,
  observedGrowingContext: null,
  observedAt: '2026-07-21T09:00:00Z',
  recordedAt: '2026-07-21T09:00:00Z',
  photos: [],
  measurements: [],
};

describe('createObservationGateway', () => {
  it('posts the request body and idempotency key on record', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(OBSERVATION, 201));

    await gateway.record(
      GARDEN_ID,
      { noteText: 'Leaves looking healthy', photos: [], measurements: [] },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/observations`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      noteText: 'Leaves looking healthy',
      photos: [],
      measurements: [],
    });
  });

  it('lists the garden timeline', async () => {
    const list: ObservationListResult = { items: [OBSERVATION] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    const result = await gateway.listForGarden(GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/observations`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: list }));
  });

  it('lists a plant timeline', async () => {
    const list: ObservationListResult = { items: [] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    await gateway.listForPlant(GARDEN_ID, PLANT_ID);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/plants/${PLANT_ID}/observations`,
    );
  });

  it('posts to the observation-scoped corrections resource, not the garden-scoped one', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(OBSERVATION, 201));

    await gateway.correct(
      OBSERVATION_ID,
      { correctionKind: 'amendment', photos: [], measurements: [] },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/observations/${OBSERVATION_ID}/corrections`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(headersOf(recorded[0]!)['if-match']).toBeUndefined();
  });

  it('posts the disposition to the analysis-result-scoped resource without an If-Match header', async () => {
    const RESULT: ImageAnalysisResult = {
      id: ANALYSIS_RESULT_ID,
      analysisKind: 'disease',
      suggestedLabel: 'Possible leaf spot',
      confidenceScore: 0.6,
      requiresConfirmation: true,
      requestedAdditionalEvidence: false,
      evidenceSummary: 'Brown spotting on lower leaves.',
      alternativeExplanations: ['Nutrient deficiency'],
      safetyClass: 'monitor',
      requestedViewPurposes: [],
      modelName: 'gemini-test',
      promptVersion: 3,
      disposition: 'accepted_as_observation',
      dispositionSetAt: '2026-07-22T09:00:00Z',
      dispositionSetByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
      createdAt: '2026-07-21T09:00:00Z',
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(RESULT, 200));

    const result = await gateway.setHealthSuggestionDisposition(
      ANALYSIS_RESULT_ID,
      'accepted_as_observation',
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/observations/analysis-results/${ANALYSIS_RESULT_ID}/disposition`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(headersOf(recorded[0]!)['if-match']).toBeUndefined();
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      disposition: 'accepted_as_observation',
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, data: RESULT }));
  });
});
