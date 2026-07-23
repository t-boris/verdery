import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createPlantIdentification, validateConfidenceScore } from './plant-identification.js';

const IDENTIFICATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NOW = new Date('2026-07-21T09:00:00Z');

describe('createPlantIdentification', () => {
  it('builds an identification row with the given fields', () => {
    const identification = createPlantIdentification(
      IDENTIFICATION_ID,
      PLANT_ID,
      PHOTO_ID,
      TAXONOMY_ID,
      0.75,
      NOW,
    );

    expect(identification).toEqual({
      id: IDENTIFICATION_ID,
      plantId: PLANT_ID,
      plantPhotoId: PHOTO_ID,
      suggestedTaxonomyId: TAXONOMY_ID,
      confidenceScore: 0.75,
      createdAt: NOW,
    });
  });

  it('accepts a null suggestedTaxonomyId and zero confidence, matching the photo-identification stub', () => {
    const identification = createPlantIdentification(
      IDENTIFICATION_ID,
      PLANT_ID,
      PHOTO_ID,
      null,
      0,
      NOW,
    );
    expect(identification.suggestedTaxonomyId).toBeNull();
    expect(identification.confidenceScore).toBe(0);
  });

  it('rejects a confidence score outside 0..1', () => {
    expect(() =>
      createPlantIdentification(IDENTIFICATION_ID, PLANT_ID, PHOTO_ID, TAXONOMY_ID, 1.5, NOW),
    ).toThrow(ValidationError);
    expect(() =>
      createPlantIdentification(IDENTIFICATION_ID, PLANT_ID, PHOTO_ID, TAXONOMY_ID, -0.1, NOW),
    ).toThrow(ValidationError);
  });
});

describe('validateConfidenceScore', () => {
  it('returns the value when within range', () => {
    expect(validateConfidenceScore(0.5)).toBe(0.5);
    expect(validateConfidenceScore(0)).toBe(0);
    expect(validateConfidenceScore(1)).toBe(1);
  });

  it('rejects a non-finite value', () => {
    expect(() => validateConfidenceScore(Number.NaN)).toThrow(ValidationError);
  });
});
