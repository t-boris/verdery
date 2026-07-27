import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  HEMISPHERES,
  validateTaxonomySeasonalAuthoring,
  validateTaxonomySeasonalFactProvenance,
  validateTaxonomySeasonalReview,
} from './taxonomy-seasonal-fact.js';

describe('HEMISPHERES', () => {
  it('names exactly the two hemispheres the migration CHECK constraint accepts', () => {
    expect([...HEMISPHERES].sort()).toEqual(['northern', 'southern'].sort());
  });
});

describe('validateTaxonomySeasonalAuthoring', () => {
  it('accepts human_authored with no sourceCitation', () => {
    expect(validateTaxonomySeasonalAuthoring({ authoringMethod: 'human_authored' })).toEqual({
      authoringMethod: 'human_authored',
    });
  });

  it('accepts ai_proposed_reviewed with no sourceCitation', () => {
    expect(validateTaxonomySeasonalAuthoring({ authoringMethod: 'ai_proposed_reviewed' })).toEqual({
      authoringMethod: 'ai_proposed_reviewed',
    });
  });

  it('accepts ai_extracted_from_source with a sourceCitation', () => {
    expect(
      validateTaxonomySeasonalAuthoring({
        authoringMethod: 'ai_extracted_from_source',
        sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
      }),
    ).toEqual({
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
    });
  });

  it('rejects an unrecognized authoringMethod', () => {
    expect(() => validateTaxonomySeasonalAuthoring({ authoringMethod: 'guessed' })).toThrow(
      ValidationError,
    );
  });

  it('rejects ai_extracted_from_source missing sourceCitation — the missing-required-field direction', () => {
    expect(() =>
      validateTaxonomySeasonalAuthoring({ authoringMethod: 'ai_extracted_from_source' }),
    ).toThrow(ValidationError);
  });

  it('rejects a blank sourceCitation for ai_extracted_from_source', () => {
    expect(() =>
      validateTaxonomySeasonalAuthoring({
        authoringMethod: 'ai_extracted_from_source',
        sourceCitation: '   ',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects human_authored carrying a sourceCitation — the disallowed-extra-field direction', () => {
    expect(() =>
      validateTaxonomySeasonalAuthoring({
        authoringMethod: 'human_authored',
        sourceCitation: 'Some source',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects ai_proposed_reviewed carrying a sourceCitation — same disallowed-extra-field direction, different method', () => {
    expect(() =>
      validateTaxonomySeasonalAuthoring({
        authoringMethod: 'ai_proposed_reviewed',
        sourceCitation: 'Some source',
      }),
    ).toThrow(ValidationError);
  });

  it('treats null sourceCitation the same as omitted', () => {
    expect(
      validateTaxonomySeasonalAuthoring({
        authoringMethod: 'human_authored',
        sourceCitation: null,
      }),
    ).toEqual({ authoringMethod: 'human_authored' });
  });
});

describe('validateTaxonomySeasonalReview', () => {
  it('accepts awaiting_horticultural_review with neither reviewedBy nor reviewedOn', () => {
    expect(
      validateTaxonomySeasonalReview({ reviewStatus: 'awaiting_horticultural_review' }),
    ).toEqual({ reviewStatus: 'awaiting_horticultural_review' });
  });

  it('accepts horticulturally_reviewed with both reviewedBy and reviewedOn', () => {
    expect(
      validateTaxonomySeasonalReview({
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).toEqual({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });
  });

  it('rejects an unrecognized reviewStatus', () => {
    expect(() => validateTaxonomySeasonalReview({ reviewStatus: 'guessed' })).toThrow(
      ValidationError,
    );
  });

  it('rejects horticulturally_reviewed missing both reviewedBy and reviewedOn — the missing-required-fields direction', () => {
    expect(() =>
      validateTaxonomySeasonalReview({ reviewStatus: 'horticulturally_reviewed' }),
    ).toThrow(ValidationError);
  });

  it('rejects horticulturally_reviewed missing only reviewedOn', () => {
    expect(() =>
      validateTaxonomySeasonalReview({
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects horticulturally_reviewed missing only reviewedBy', () => {
    expect(() =>
      validateTaxonomySeasonalReview({
        reviewStatus: 'horticulturally_reviewed',
        reviewedOn: '2026-03-15',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects horticulturally_reviewed with a malformed reviewedOn', () => {
    expect(() =>
      validateTaxonomySeasonalReview({
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: 'March 15th',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects awaiting_horticultural_review carrying reviewedBy/reviewedOn — the disallowed-extra-fields direction', () => {
    expect(() =>
      validateTaxonomySeasonalReview({
        reviewStatus: 'awaiting_horticultural_review',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects reviewedBy supplied without reviewedOn, independent of reviewStatus', () => {
    expect(() =>
      validateTaxonomySeasonalReview({
        reviewStatus: 'awaiting_horticultural_review',
        reviewedBy: 'Someone',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects reviewedOn supplied without reviewedBy, independent of reviewStatus', () => {
    expect(() =>
      validateTaxonomySeasonalReview({
        reviewStatus: 'awaiting_horticultural_review',
        reviewedOn: '2026-03-15',
      }),
    ).toThrow(ValidationError);
  });

  it('treats null reviewedBy/reviewedOn the same as omitted', () => {
    expect(
      validateTaxonomySeasonalReview({
        reviewStatus: 'awaiting_horticultural_review',
        reviewedBy: null,
        reviewedOn: null,
      }),
    ).toEqual({ reviewStatus: 'awaiting_horticultural_review' });
  });
});

describe('validateTaxonomySeasonalFactProvenance', () => {
  it('validates authoring and review together, returning the combined narrowed shape', () => {
    const result = validateTaxonomySeasonalFactProvenance({
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });

    expect(result).toEqual({
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });
  });

  it('accepts the honest default every seed fixture ships: human_authored, awaiting review', () => {
    const result = validateTaxonomySeasonalFactProvenance({
      authoringMethod: 'human_authored',
      reviewStatus: 'awaiting_horticultural_review',
    });

    expect(result).toEqual({
      authoringMethod: 'human_authored',
      reviewStatus: 'awaiting_horticultural_review',
    });
  });

  it('rejects invalid authoring even when review is valid', () => {
    expect(() =>
      validateTaxonomySeasonalFactProvenance({
        authoringMethod: 'ai_extracted_from_source',
        reviewStatus: 'awaiting_horticultural_review',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid review even when authoring is valid', () => {
    expect(() =>
      validateTaxonomySeasonalFactProvenance({
        authoringMethod: 'human_authored',
        reviewStatus: 'horticulturally_reviewed',
      }),
    ).toThrow(ValidationError);
  });
});
