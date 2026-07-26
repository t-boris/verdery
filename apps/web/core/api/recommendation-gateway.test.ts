import type {
  ConvertRecommendationToTaskResult,
  Recommendation,
  Task,
  TodayResult,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createRecommendationGateway } from './recommendation-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const RECOMMENDATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
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
  return { gateway: createRecommendationGateway(client), recorded };
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

const RECOMMENDATION: Recommendation = {
  id: RECOMMENDATION_ID,
  gardenId: GARDEN_ID,
  ruleKey: 'observation.routine-check-reminder',
  ruleVersion: 1,
  careCategory: 'observation',
  safetyTier: 'ordinary_care',
  state: 'completed',
  urgency: 'low',
  targetKind: 'plant',
  targetGardenAreaMapObjectId: null,
  targetPlantId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  windowStart: '2026-07-20T09:00:00Z',
  windowEnd: '2026-07-27T09:00:00Z',
  explanation: 'Tomato row has not been observed for 16 days.',
  supersedesCandidateId: null,
  presentedAt: '2026-07-21T09:00:00Z',
  revision: 3,
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-21T10:00:00Z',
};

describe('createRecommendationGateway', () => {
  it('gets the Today set without a limit parameter by default', async () => {
    const today: TodayResult = {
      gardenId: GARDEN_ID,
      generatedAt: '2026-07-21T09:00:00Z',
      items: [],
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(today, 200));

    const result = await gateway.getToday(GARDEN_ID, null);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/today`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: today }));
  });

  it('passes an explicit limit as a query parameter', async () => {
    const today: TodayResult = {
      gardenId: GARDEN_ID,
      generatedAt: '2026-07-21T09:00:00Z',
      items: [],
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(today, 200));

    await gateway.getToday(GARDEN_ID, 5);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/today?limit=5`);
  });

  it.each([
    ['complete', 'complete'],
    ['dismiss', 'dismiss'],
    ['markIrrelevant', 'mark-irrelevant'],
  ] as const)(
    '%s posts to its sub-resource with quoted If-Match and the idempotency key',
    async (method, segment) => {
      const { gateway, recorded } = gatewayRecording(jsonResponse(RECOMMENDATION, 200));

      await gateway[method](GARDEN_ID, RECOMMENDATION_ID, 2, IDEMPOTENCY_KEY);

      expect(recorded[0]?.url).toBe(
        `${ORIGIN}/v1/gardens/${GARDEN_ID}/recommendations/${RECOMMENDATION_ID}/${segment}`,
      );
      expect(recorded[0]?.init.method).toBe('POST');
      expect(headersOf(recorded[0]!)['if-match']).toBe('"2"');
      expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    },
  );

  it('posts the optional postponedUntil horizon on postpone', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(RECOMMENDATION, 200));

    await gateway.postpone(
      GARDEN_ID,
      RECOMMENDATION_ID,
      { postponedUntil: '2026-08-01T09:00:00Z' },
      2,
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/recommendations/${RECOMMENDATION_ID}/postpone`,
    );
    expect(recorded[0]?.init.body).toBe(JSON.stringify({ postponedUntil: '2026-08-01T09:00:00Z' }));
    expect(headersOf(recorded[0]!)['if-match']).toBe('"2"');
  });

  it('posts to convert-to-task and returns the recommendation-task pair', async () => {
    const task: Task = {
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
      gardenId: GARDEN_ID,
      targetKind: 'plant',
      targetGardenAreaMapObjectId: null,
      targetPlantId: RECOMMENDATION.targetPlantId,
      title: 'Record a quick condition check for this plant',
      notes: RECOMMENDATION.explanation,
      status: 'planned',
      dueDate: null,
      timeWindowStart: RECOMMENDATION.windowStart,
      timeWindowEnd: RECOMMENDATION.windowEnd,
      recurrenceRule: null,
      urgency: 'low',
      source: 'suggested',
      originObservationId: null,
      originRecommendationId: RECOMMENDATION_ID,
      revision: 1,
      createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      createdAt: '2026-07-21T10:00:00Z',
      updatedAt: '2026-07-21T10:00:00Z',
      completedAt: null,
      assignedProfileId: null,
      assignedAt: null,
      completedByProfileId: null,
    };
    const conversion: ConvertRecommendationToTaskResult = {
      recommendation: RECOMMENDATION,
      task,
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(conversion, 201));

    const result = await gateway.convertToTask(GARDEN_ID, RECOMMENDATION_ID, 2, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/recommendations/${RECOMMENDATION_ID}/convert-to-task`,
    );
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(result).toEqual(expect.objectContaining({ ok: true, data: conversion }));
  });
});
