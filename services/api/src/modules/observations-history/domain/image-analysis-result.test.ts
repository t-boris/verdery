import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import {
  AnalyzePlantCondition,
  type PlantConditionAnalysisAdapterOutcome,
  type PlantConditionAnalysisProviderAdapter,
  type PlantConditionAnalysisRequest,
  type PlantConditionModelIdentity,
  type PlantPhotoReference,
} from '../../integrations/public.js';
import { analyzeObservationPhoto, createImageAnalysisResult } from './image-analysis-result.js';
import { AlwaysAllowProviderQuotaRepository } from '../application/plant-ai-test-doubles.js';

const RESULT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a21';
const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a22';
const NOW = new Date('2026-07-21T09:00:00Z');
const PROVIDER_KEY = 'vertex-ai-plant-condition';
const PHOTO: PlantPhotoReference = {
  bucketName: 'test-user-media',
  objectKey: 'gardens/test-garden/plants/test-photo.jpg',
  mimeType: 'image/jpeg',
};

/** A scriptable fake, local to this file per this codebase's cross-module-boundary convention (test doubles stay module-internal; `integrations-test-doubles.ts` is not part of `integrations/public.ts`). */
class FakePlantConditionAnalysisProviderAdapter implements PlantConditionAnalysisProviderAdapter {
  readonly identity: PlantConditionModelIdentity = {
    model: 'fake-plant-condition-model',
    promptTemplateVersion: 1,
  };

  constructor(private readonly outcome: PlantConditionAnalysisAdapterOutcome) {}

  analyzeCondition(
    _request: PlantConditionAnalysisRequest,
    _signal: AbortSignal,
  ): Promise<PlantConditionAnalysisAdapterOutcome> {
    return Promise.resolve(this.outcome);
  }
}

function analyzePlantConditionWith(
  adapter: PlantConditionAnalysisProviderAdapter | null,
): AnalyzePlantCondition {
  return new AnalyzePlantCondition(
    adapter,
    {
      providerKey: PROVIDER_KEY,
      callTimeoutMs: 1_000,
      quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    },
    new AlwaysAllowProviderQuotaRepository(),
    { now: () => NOW },
    pino({ level: 'silent' }),
  );
}

describe('analyzeObservationPhoto', () => {
  it('returns the honest fixed outcome when the capability is disabled (the kill-switch off, every environment today)', async () => {
    const outcome = await analyzeObservationPhoto(analyzePlantConditionWith(null), PHOTO);

    expect(outcome).toEqual({
      analysisKind: 'other',
      suggestedLabel: 'No automated analysis available yet.',
      confidenceScore: 0,
      requestedAdditionalEvidence: true,
    });
  });

  it('passes a real observation through when the provider is enabled and confident', async () => {
    const adapter = new FakePlantConditionAnalysisProviderAdapter({
      kind: 'observation',
      observation: {
        kind: 'stress',
        suggestedLabel: 'Wilting leaves',
        confidenceScore: 0.7,
        requestedAdditionalEvidence: false,
        careGuidanceSuggestion: '',
      },
    });

    const outcome = await analyzeObservationPhoto(analyzePlantConditionWith(adapter), PHOTO);

    expect(outcome).toEqual({
      analysisKind: 'stress',
      suggestedLabel: 'Wilting leaves',
      confidenceScore: 0.7,
      requestedAdditionalEvidence: false,
    });
  });
});

describe('createImageAnalysisResult', () => {
  it('builds a result row with requiresConfirmation always true, never a caller-supplied value', async () => {
    const result = await createImageAnalysisResult(
      analyzePlantConditionWith(null),
      RESULT_ID,
      PHOTO_ID,
      PHOTO,
      NOW,
    );

    expect(result).toEqual({
      id: RESULT_ID,
      observationPhotoId: PHOTO_ID,
      analysisKind: 'other',
      suggestedLabel: 'No automated analysis available yet.',
      confidenceScore: 0,
      requiresConfirmation: true,
      requestedAdditionalEvidence: true,
      createdAt: NOW,
    });
  });
});
