import { describe, expect, it } from 'vitest';
import { analyzeObservationPhoto, createImageAnalysisResult } from './image-analysis-result.js';

const RESULT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a21';
const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a22';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a23';
const NOW = new Date('2026-07-21T09:00:00Z');

describe('analyzeObservationPhoto', () => {
  it('returns a fixed, honestly-fake outcome regardless of mediaId', () => {
    expect(analyzeObservationPhoto(MEDIA_ID)).toEqual({
      analysisKind: 'other',
      suggestedLabel: 'No automated analysis available yet.',
      confidenceScore: 0,
      requestedAdditionalEvidence: true,
    });
    expect(analyzeObservationPhoto('some-other-media-id')).toEqual(
      analyzeObservationPhoto(MEDIA_ID),
    );
  });
});

describe('createImageAnalysisResult', () => {
  it('builds a result row with requiresConfirmation always true, never a caller-supplied value', () => {
    const result = createImageAnalysisResult(RESULT_ID, PHOTO_ID, MEDIA_ID, NOW);

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
