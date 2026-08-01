import { describe, expect, it } from 'vitest';
import { createPlantDistributionAssertion } from '../domain/plant-distribution-assertion.js';
import { createPlantFactAssertion } from '../domain/plant-fact-assertion.js';
import type { PlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import { ListPlantAssertionsAwaitingReview } from './list-plant-assertions-awaiting-review.js';
import {
  InMemoryPlantDistributionAssertionRepository,
  InMemoryPlantFactAssertionRepository,
} from './plant-assertion-provider-test-doubles.js';
import { InMemoryPlantTaxonomyMappingRepository } from './integrations-test-doubles.js';

const NOW = new Date('2026-08-01T00:00:00.000Z');

function factInput(overrides: Partial<Parameters<typeof createPlantFactAssertion>[0]> = {}) {
  return createPlantFactAssertion({
    id: 'fact-1',
    rawProviderTaxonId: 'gbif-2879737',
    rawFactKey: 'occurrence_evidence_count',
    factValue: '51258',
    unit: 'records',
    confidence: null,
    geographicScope: null,
    authoring: {
      authoringMethod: 'ai_extracted_from_source',
      providerKey: 'gbif',
      sourceCitation: 'GBIF.org',
    },
    review: { reviewStatus: 'awaiting_horticultural_review' },
    fetchedAt: NOW,
    now: NOW,
    ...overrides,
  });
}

function distributionInput(
  overrides: Partial<Parameters<typeof createPlantDistributionAssertion>[0]> = {},
) {
  return createPlantDistributionAssertion({
    id: 'dist-1',
    rawProviderTaxonId: '70172',
    rawRegion: 'L48',
    rawStatus: 'native',
    confidence: null,
    authoring: {
      authoringMethod: 'ai_extracted_from_source',
      providerKey: 'usda-plants',
      sourceCitation: 'USDA',
    },
    review: { reviewStatus: 'awaiting_horticultural_review' },
    fetchedAt: NOW,
    now: NOW,
    ...overrides,
  });
}

function taxonomyMapping(overrides: Partial<PlantTaxonomyMapping> = {}): PlantTaxonomyMapping {
  return {
    id: 'mapping-1',
    taxonomyReferenceId: 'taxonomy-1',
    providerKey: 'gbif',
    providerTaxonId: 'gbif-2879737',
    providerScientificName: 'Quercus alba',
    confidence: 0.98,
    verificationState: 'unverified',
    stateNote: null,
    stateChangedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe('ListPlantAssertionsAwaitingReview', () => {
  it('lists pending facts and distributions together, each enriched with the resolved scientific name', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    const mappings = new InMemoryPlantTaxonomyMappingRepository();
    facts.assertions.push(factInput());
    distributions.assertions.push(distributionInput());
    mappings.mappings.push(taxonomyMapping());
    mappings.mappings.push(
      taxonomyMapping({
        id: 'mapping-2',
        providerKey: 'usda-plants',
        providerTaxonId: '70172',
        providerScientificName: 'Quercus alba',
      }),
    );

    const list = new ListPlantAssertionsAwaitingReview(facts, distributions, mappings, [
      'reviewer@example.com',
    ]);
    const result = await list.execute({ email: 'reviewer@example.com', emailVerified: true });

    expect(result).toHaveLength(2);
    const factItem = result.find((item) => item.kind === 'fact');
    const distributionItem = result.find((item) => item.kind === 'distribution');
    expect(factItem?.providerScientificName).toBe('Quercus alba');
    expect(distributionItem?.providerScientificName).toBe('Quercus alba');
  });

  it('answers null for a provider taxon with no resolvable mapping, never a guess', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    const mappings = new InMemoryPlantTaxonomyMappingRepository();
    facts.assertions.push(factInput());

    const list = new ListPlantAssertionsAwaitingReview(facts, distributions, mappings, [
      'reviewer@example.com',
    ]);
    const result = await list.execute({ email: 'reviewer@example.com', emailVerified: true });

    expect(result).toEqual([
      expect.objectContaining({ kind: 'fact', providerScientificName: null }),
    ]);
  });

  it('excludes already-reviewed assertions', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    const mappings = new InMemoryPlantTaxonomyMappingRepository();
    facts.assertions.push(
      factInput({
        id: 'fact-reviewed',
        review: {
          reviewStatus: 'horticulturally_reviewed',
          reviewedBy: 'reviewer@example.com',
          reviewedOn: '2026-07-30',
        },
      }),
    );

    const list = new ListPlantAssertionsAwaitingReview(facts, distributions, mappings, [
      'reviewer@example.com',
    ]);
    const result = await list.execute({ email: 'reviewer@example.com', emailVerified: true });

    expect(result).toEqual([]);
  });

  it('rejects an actor whose email is not on the reviewer allowlist', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    const mappings = new InMemoryPlantTaxonomyMappingRepository();

    const list = new ListPlantAssertionsAwaitingReview(facts, distributions, mappings, [
      'reviewer@example.com',
    ]);

    await expect(
      list.execute({ email: 'not-a-reviewer@example.com', emailVerified: true }),
    ).rejects.toThrow();
  });

  it('rejects every actor when no reviewer is configured', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    const mappings = new InMemoryPlantTaxonomyMappingRepository();

    const list = new ListPlantAssertionsAwaitingReview(facts, distributions, mappings, []);

    await expect(
      list.execute({ email: 'reviewer@example.com', emailVerified: true }),
    ).rejects.toThrow();
  });
});
