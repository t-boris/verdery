import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CreatePlantTaxonomyMappingInput } from './plant-taxonomy-mapping.js';
import {
  createPlantTaxonomyMapping,
  validateMappingStateTransition,
} from './plant-taxonomy-mapping.js';

const MAPPING_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f01';
const TAXONOMY_REFERENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f02';
const NOW = new Date('2026-07-25T12:00:00Z');

function validInput(
  overrides: Partial<CreatePlantTaxonomyMappingInput> = {},
): CreatePlantTaxonomyMappingInput {
  return {
    id: MAPPING_ID,
    taxonomyReferenceId: TAXONOMY_REFERENCE_ID,
    rawProviderKey: 'fake-plant-provider-a',
    rawProviderTaxonId: 'taxon-1001',
    providerScientificName: 'Solanum lycopersicum',
    confidence: 0.92,
    now: NOW,
    ...overrides,
  };
}

describe('createPlantTaxonomyMapping', () => {
  it('builds an UNVERIFIED mapping — a machine-created identity claim cannot claim a human verified it', () => {
    const mapping = createPlantTaxonomyMapping(
      validInput({ rawProviderKey: '  fake-plant-provider-a  ' }),
    );

    expect(mapping.verificationState).toBe('unverified');
    expect(mapping.stateNote).toBeNull();
    expect(mapping.providerKey).toBe('fake-plant-provider-a');
    expect(mapping.providerTaxonId).toBe('taxon-1001');
    expect(mapping.providerScientificName).toBe('Solanum lycopersicum');
    expect(mapping.confidence).toBe(0.92);
    expect(mapping.stateChangedAt).toBe(NOW);
    expect(mapping.createdAt).toBe(NOW);
  });

  it('accepts a provider that reported no confidence or name: never invented', () => {
    const mapping = createPlantTaxonomyMapping(
      validInput({ providerScientificName: null, confidence: null }),
    );

    expect(mapping.providerScientificName).toBeNull();
    expect(mapping.confidence).toBeNull();
  });

  it('rejects blank identity fields', () => {
    expect(() => createPlantTaxonomyMapping(validInput({ rawProviderKey: ' ' }))).toThrow(
      ValidationError,
    );
    expect(() => createPlantTaxonomyMapping(validInput({ rawProviderTaxonId: '' }))).toThrow(
      ValidationError,
    );
    expect(() => createPlantTaxonomyMapping(validInput({ providerScientificName: '  ' }))).toThrow(
      ValidationError,
    );
  });

  it('rejects an out-of-range or non-finite confidence', () => {
    for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createPlantTaxonomyMapping(validInput({ confidence }))).toThrow(ValidationError);
    }
  });
});

describe('validateMappingStateTransition', () => {
  it('allows the one-way lifecycle: unverified -> verified, unverified -> rejected, verified -> rejected', () => {
    expect(() => validateMappingStateTransition('unverified', 'verified')).not.toThrow();
    expect(() => validateMappingStateTransition('unverified', 'rejected')).not.toThrow();
    expect(() => validateMappingStateTransition('verified', 'rejected')).not.toThrow();
  });

  it('rejects every other move: nothing leaves rejected, nothing returns to unverified, no self-moves', () => {
    const forbidden: readonly [
      Parameters<typeof validateMappingStateTransition>[0],
      Parameters<typeof validateMappingStateTransition>[1],
    ][] = [
      ['rejected', 'unverified'],
      ['rejected', 'verified'],
      ['rejected', 'rejected'],
      ['verified', 'unverified'],
      ['verified', 'verified'],
      ['unverified', 'unverified'],
    ];
    for (const [from, to] of forbidden) {
      expect(() => validateMappingStateTransition(from, to)).toThrow(ValidationError);
    }
  });
});
