import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createPlantDistributionAssertion } from './plant-distribution-assertion.js';

const ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const NOW = new Date('2026-07-29T12:00:00Z');

function baseInput() {
  return {
    id: ID,
    rawProviderTaxonId: 'PROV-123',
    rawRegion: 'US-CA',
    rawStatus: 'native',
    confidence: null,
    authoring: {
      authoringMethod: 'ai_extracted_from_source' as const,
      providerKey: 'usda-plants',
      sourceCitation: 'USDA PLANTS, accessed 2026-07-29',
    },
    review: { reviewStatus: 'awaiting_horticultural_review' as const },
    fetchedAt: NOW,
    now: NOW,
  };
}

describe('createPlantDistributionAssertion', () => {
  it('creates a well-formed native-status assertion', () => {
    const assertion = createPlantDistributionAssertion(baseInput());
    expect(assertion.status).toBe('native');
    expect(assertion.region).toBe('US-CA');
  });

  it('rejects an unrecognized status', () => {
    expect(() =>
      createPlantDistributionAssertion({ ...baseInput(), rawStatus: 'endangered' }),
    ).toThrow(ValidationError);
  });

  it('rejects a blank region', () => {
    expect(() => createPlantDistributionAssertion({ ...baseInput(), rawRegion: '' })).toThrow(
      ValidationError,
    );
  });

  it('accepts human-authored regulated status with the human sentinel', () => {
    const assertion = createPlantDistributionAssertion({
      ...baseInput(),
      rawStatus: 'regulated',
      authoring: { authoringMethod: 'human_authored', providerKey: 'human' },
    });
    expect(assertion.status).toBe('regulated');
  });
});
