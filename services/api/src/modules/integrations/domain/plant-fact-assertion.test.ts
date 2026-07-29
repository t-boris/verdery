import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createPlantFactAssertion } from './plant-fact-assertion.js';

const ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const NOW = new Date('2026-07-29T12:00:00Z');

function baseInput() {
  return {
    id: ID,
    rawProviderTaxonId: 'PROV-123',
    rawFactKey: 'hardinessZoneMin',
    factValue: 6,
    unit: null,
    confidence: 0.8,
    geographicScope: null,
    authoring: {
      authoringMethod: 'ai_extracted_from_source',
      providerKey: 'usda-plants',
      sourceCitation: 'USDA PLANTS, accessed 2026-07-29',
    },
    review: { reviewStatus: 'awaiting_horticultural_review' as const },
    fetchedAt: NOW,
    now: NOW,
  };
}

describe('createPlantFactAssertion', () => {
  it('creates a well-formed extracted fact awaiting review', () => {
    const assertion = createPlantFactAssertion(baseInput());
    expect(assertion.factKey).toBe('hardinessZoneMin');
    expect(assertion.provenance).toMatchObject({
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation: 'USDA PLANTS, accessed 2026-07-29',
    });
  });

  it('rejects a blank providerTaxonId', () => {
    expect(() => createPlantFactAssertion({ ...baseInput(), rawProviderTaxonId: '  ' })).toThrow(
      ValidationError,
    );
  });

  it('rejects an out-of-range confidence', () => {
    expect(() => createPlantFactAssertion({ ...baseInput(), confidence: 1.5 })).toThrow(
      ValidationError,
    );
  });

  it('rejects toxicity authored by anything other than a human', () => {
    expect(() => createPlantFactAssertion({ ...baseInput(), rawFactKey: 'toxicity' })).toThrow(
      ValidationError,
    );
  });

  it('accepts human-authored toxicity with the human provider sentinel', () => {
    const assertion = createPlantFactAssertion({
      ...baseInput(),
      rawFactKey: 'toxicity',
      rawProviderTaxonId: 'some-taxonomy-reference-id',
      authoring: { authoringMethod: 'human_authored', providerKey: 'human' },
    });
    expect(assertion.factKey).toBe('toxicity');
    expect(assertion.provenance.authoringMethod).toBe('human_authored');
  });

  it('rejects edibility proposed for AI review, not only extracted', () => {
    expect(() =>
      createPlantFactAssertion({
        ...baseInput(),
        rawFactKey: 'edibility',
        authoring: { authoringMethod: 'ai_proposed_reviewed', providerKey: 'human' },
      }),
    ).toThrow(ValidationError);
  });
});
