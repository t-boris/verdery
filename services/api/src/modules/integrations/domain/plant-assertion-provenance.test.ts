import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  validatePlantAssertionAuthoring,
  validatePlantAssertionReview,
} from './plant-assertion-provenance.js';

describe('validatePlantAssertionAuthoring', () => {
  it('accepts a well-formed extraction with citation', () => {
    const authoring = validatePlantAssertionAuthoring({
      authoringMethod: 'ai_extracted_from_source',
      providerKey: 'usda-plants',
      sourceCitation: 'USDA PLANTS',
    });
    expect(authoring).toEqual({
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation: 'USDA PLANTS',
      providerKey: 'usda-plants',
    });
  });

  it('rejects an unrecognized authoringMethod', () => {
    expect(() =>
      validatePlantAssertionAuthoring({ authoringMethod: 'guessed', providerKey: 'usda-plants' }),
    ).toThrow(ValidationError);
  });

  it('rejects extraction with no citation', () => {
    expect(() =>
      validatePlantAssertionAuthoring({
        authoringMethod: 'ai_extracted_from_source',
        providerKey: 'usda-plants',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-extraction method carrying a citation', () => {
    expect(() =>
      validatePlantAssertionAuthoring({
        authoringMethod: 'human_authored',
        providerKey: 'human',
        sourceCitation: 'Should not be here',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects human_authored with a non-human providerKey', () => {
    expect(() =>
      validatePlantAssertionAuthoring({
        authoringMethod: 'human_authored',
        providerKey: 'usda-plants',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a blank providerKey', () => {
    expect(() =>
      validatePlantAssertionAuthoring({
        authoringMethod: 'ai_proposed_reviewed',
        providerKey: '  ',
      }),
    ).toThrow(ValidationError);
  });
});

describe('validatePlantAssertionReview', () => {
  it('accepts awaiting review with no reviewer', () => {
    expect(validatePlantAssertionReview({ reviewStatus: 'awaiting_horticultural_review' })).toEqual(
      {
        reviewStatus: 'awaiting_horticultural_review',
      },
    );
  });

  it('accepts a reviewed fact with reviewer and date', () => {
    const review = validatePlantAssertionReview({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-07-29',
    });
    expect(review).toEqual({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-07-29',
    });
  });

  it('rejects horticulturally_reviewed with no reviewer', () => {
    expect(() =>
      validatePlantAssertionReview({ reviewStatus: 'horticulturally_reviewed' }),
    ).toThrow(ValidationError);
  });

  it('rejects awaiting review carrying a reviewer', () => {
    expect(() =>
      validatePlantAssertionReview({
        reviewStatus: 'awaiting_horticultural_review',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-07-29',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a malformed reviewedOn date', () => {
    expect(() =>
      validatePlantAssertionReview({
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: 'not-a-date',
      }),
    ).toThrow(ValidationError);
  });
});
