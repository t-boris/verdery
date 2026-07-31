import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  AnalyzePlantCondition,
  type PlantConditionAnalysisAdapterOutcome,
  type PlantConditionAnalysisProviderAdapter,
  type PlantConditionAnalysisRequest,
  type PlantConditionHistoryEntry,
  type PlantConditionModelIdentity,
  type PlantPhotoReference,
} from '../../integrations/public.js';
import { AlwaysAllowProviderQuotaRepository } from '../application/plant-ai-test-doubles.js';
import {
  analyzeObservationPhoto,
  applyHealthSuggestionDisposition,
  createImageAnalysisResult,
  type ImageAnalysisResult,
} from './image-analysis-result.js';

const RESULT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a21';
const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a22';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a23';
const NOW = new Date('2026-07-21T09:00:00Z');
const PROVIDER_KEY = 'vertex-ai-plant-condition';
const PHOTO: PlantPhotoReference = {
  bucketName: 'test-user-media',
  objectKey: 'gardens/test-garden/plants/test-photo.jpg',
  mimeType: 'image/jpeg',
};
const NO_PRIOR_PHOTOS: readonly PlantConditionHistoryEntry[] = [];

/** A scriptable fake, local to this file per this codebase's cross-module-boundary convention (test doubles stay module-internal; `integrations-test-doubles.ts` is not part of `integrations/public.ts`). */
class FakePlantConditionAnalysisProviderAdapter implements PlantConditionAnalysisProviderAdapter {
  readonly identity: PlantConditionModelIdentity = {
    model: 'fake-plant-condition-model',
    promptTemplateVersion: 1,
  };

  lastRequest: PlantConditionAnalysisRequest | null = null;

  constructor(private readonly outcome: PlantConditionAnalysisAdapterOutcome) {}

  analyzeCondition(
    request: PlantConditionAnalysisRequest,
    _signal: AbortSignal,
  ): Promise<PlantConditionAnalysisAdapterOutcome> {
    this.lastRequest = request;
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
    const outcome = await analyzeObservationPhoto(
      analyzePlantConditionWith(null),
      PHOTO,
      NO_PRIOR_PHOTOS,
    );

    expect(outcome).toEqual({
      analysisKind: 'other',
      suggestedLabel: 'No automated analysis available yet.',
      confidenceScore: 0,
      requestedAdditionalEvidence: true,
      evidenceSummary: '',
      alternativeExplanations: [],
      safetyClass: 'informational',
      requestedViewPurposes: [],
      modelName: null,
      promptVersion: null,
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
        evidenceSummary: 'Lower leaves yellowing',
        alternativeExplanations: ['Nutrient deficiency'],
        safetyClass: 'monitor',
        requestedViewPurposes: [],
      },
    });

    const outcome = await analyzeObservationPhoto(
      analyzePlantConditionWith(adapter),
      PHOTO,
      NO_PRIOR_PHOTOS,
    );

    expect(outcome).toEqual({
      analysisKind: 'stress',
      suggestedLabel: 'Wilting leaves',
      confidenceScore: 0.7,
      requestedAdditionalEvidence: false,
      evidenceSummary: 'Lower leaves yellowing',
      alternativeExplanations: ['Nutrient deficiency'],
      safetyClass: 'monitor',
      requestedViewPurposes: [],
      modelName: 'fake-plant-condition-model',
      promptVersion: 1,
    });
  });

  it('still captures modelName/promptVersion for a schema-invalid response, even though no observation resulted', async () => {
    const adapter = new FakePlantConditionAnalysisProviderAdapter({
      kind: 'schemaInvalid',
      rawText: 'not json',
    });

    const outcome = await analyzeObservationPhoto(
      analyzePlantConditionWith(adapter),
      PHOTO,
      NO_PRIOR_PHOTOS,
    );

    expect(outcome).toMatchObject({
      analysisKind: 'other',
      modelName: 'fake-plant-condition-model',
      promptVersion: 1,
    });
  });

  it('forwards priorPhotos through to the provider request unchanged', async () => {
    const priorPhotos: readonly PlantConditionHistoryEntry[] = [
      { photo: PHOTO, observedAt: '2026-07-01T00:00:00.000Z' },
    ];
    const adapter = new FakePlantConditionAnalysisProviderAdapter({
      kind: 'observation',
      observation: {
        kind: 'other',
        suggestedLabel: '',
        confidenceScore: 0,
        requestedAdditionalEvidence: false,
        careGuidanceSuggestion: '',
        evidenceSummary: '',
        alternativeExplanations: [],
        safetyClass: 'informational',
        requestedViewPurposes: [],
      },
    });

    await analyzeObservationPhoto(analyzePlantConditionWith(adapter), PHOTO, priorPhotos);

    expect(adapter.lastRequest?.priorPhotos).toEqual(priorPhotos);
  });
});

describe('createImageAnalysisResult', () => {
  it('builds a result row with requiresConfirmation always true, never a caller-supplied value, and an unresolved disposition', async () => {
    const result = await createImageAnalysisResult(
      analyzePlantConditionWith(null),
      RESULT_ID,
      PHOTO_ID,
      PHOTO,
      NO_PRIOR_PHOTOS,
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
      evidenceSummary: '',
      alternativeExplanations: [],
      safetyClass: 'informational',
      requestedViewPurposes: [],
      modelName: null,
      promptVersion: null,
      disposition: 'unresolved',
      dispositionSetAt: null,
      dispositionSetByProfileId: null,
      createdAt: NOW,
    });
  });
});

function baseResult(): ImageAnalysisResult {
  return {
    id: RESULT_ID,
    observationPhotoId: PHOTO_ID,
    analysisKind: 'stress',
    suggestedLabel: 'Wilting leaves',
    confidenceScore: 0.7,
    requiresConfirmation: true,
    requestedAdditionalEvidence: false,
    evidenceSummary: 'Lower leaves yellowing',
    alternativeExplanations: [],
    safetyClass: 'monitor',
    requestedViewPurposes: [],
    modelName: 'fake-plant-condition-model',
    promptVersion: 1,
    disposition: 'unresolved',
    dispositionSetAt: null,
    dispositionSetByProfileId: null,
    createdAt: NOW,
  };
}

describe('applyHealthSuggestionDisposition', () => {
  const laterNow = new Date('2026-07-22T09:00:00Z');

  it.each(['confirmed_externally', 'accepted_as_observation', 'rejected'] as const)(
    'sets disposition to %s together with dispositionSetAt/dispositionSetByProfileId',
    (disposition) => {
      const updated = applyHealthSuggestionDisposition(
        baseResult(),
        disposition,
        PROFILE_ID,
        laterNow,
      );

      expect(updated.disposition).toBe(disposition);
      expect(updated.dispositionSetAt).toEqual(laterNow);
      expect(updated.dispositionSetByProfileId).toBe(PROFILE_ID);
    },
  );

  it('clears dispositionSetAt/dispositionSetByProfileId when reset back to unresolved', () => {
    const resolved = applyHealthSuggestionDisposition(
      baseResult(),
      'rejected',
      PROFILE_ID,
      laterNow,
    );

    const reset = applyHealthSuggestionDisposition(resolved, 'unresolved', PROFILE_ID, laterNow);

    expect(reset.disposition).toBe('unresolved');
    expect(reset.dispositionSetAt).toBeNull();
    expect(reset.dispositionSetByProfileId).toBeNull();
  });

  it('rejects an unrecognized disposition', () => {
    expect(() =>
      applyHealthSuggestionDisposition(baseResult(), 'ignored', PROFILE_ID, laterNow),
    ).toThrow(ValidationError);
  });

  it('leaves every other field untouched', () => {
    const original = baseResult();
    const updated = applyHealthSuggestionDisposition(original, 'rejected', PROFILE_ID, laterNow);

    expect(updated.suggestedLabel).toBe(original.suggestedLabel);
    expect(updated.confidenceScore).toBe(original.confidenceScore);
    expect(updated.evidenceSummary).toBe(original.evidenceSummary);
  });
});
