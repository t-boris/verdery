/**
 * Read-surface tests for `GetPlantContent`: typed absence reasons, the
 * provenance-carrying `available` shape, and the rejected-mapping behavior
 * that keeps re-identification explicit.
 */

import { describe, expect, it } from 'vitest';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import { createPlantContentRecord } from '../domain/plant-content-record.js';
import { createPlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import { GetPlantContent } from './get-plant-content.js';
import {
  InMemoryPlantContentRecordRepository,
  InMemoryPlantTaxonomyMappingRepository,
  testPlantContent,
} from './integrations-test-doubles.js';

const TAXONOMY_REFERENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa201';
const NOW = new Date('2026-07-25T12:00:00Z');
const PROVIDER_KEY = 'fake-plant-provider-a';

function makeStores() {
  return {
    mappings: new InMemoryPlantTaxonomyMappingRepository(),
    contentRecords: new InMemoryPlantContentRecordRepository(),
  };
}

async function seedMapping(
  mappings: InMemoryPlantTaxonomyMappingRepository,
  providerTaxonId = 'taxon-1001',
): Promise<string> {
  const mapping = createPlantTaxonomyMapping({
    id: generateUuidV7(),
    taxonomyReferenceId: TAXONOMY_REFERENCE_ID,
    rawProviderKey: PROVIDER_KEY,
    rawProviderTaxonId: providerTaxonId,
    providerScientificName: 'Solanum lycopersicum',
    confidence: 0.92,
    now: NOW,
  });
  await mappings.insert(mapping);
  return mapping.id;
}

async function seedContent(
  contentRecords: InMemoryPlantContentRecordRepository,
  providerTaxonId = 'taxon-1001',
): Promise<void> {
  const payload = testPlantContent();
  await contentRecords.insert(
    createPlantContentRecord({
      id: generateUuidV7(),
      rawProviderKey: PROVIDER_KEY,
      rawProviderTaxonId: providerTaxonId,
      source: payload.source,
      sections: payload.sections,
      fetchedAt: NOW,
      rawLicenseNote: 'test license: internal use only',
      attributionText: 'Plant content by fake-plant-provider-a',
      jurisdiction: null,
      rawPresentationNote: 'verbatim with attribution',
      now: NOW,
    }),
  );
}

describe('GetPlantContent', () => {
  it('returns the typed noProviderConfigured reason with zero providers configured — today’s reality', async () => {
    const { mappings, contentRecords } = makeStores();
    const query = new GetPlantContent(null, mappings, contentRecords);

    await expect(query.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID })).resolves.toEqual({
      outcome: 'noContent',
      reason: 'noProviderConfigured',
    });
  });

  it('returns taxonomyNotMapped for an unmapped reference and noContentStored for a mapped one with no fetches', async () => {
    const { mappings, contentRecords } = makeStores();
    const query = new GetPlantContent(PROVIDER_KEY, mappings, contentRecords);

    await expect(query.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID })).resolves.toEqual({
      outcome: 'noContent',
      reason: 'taxonomyNotMapped',
    });

    await seedMapping(mappings);
    await expect(query.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID })).resolves.toEqual({
      outcome: 'noContent',
      reason: 'noContentStored',
    });
  });

  it('serves the latest record WITH its provenance: provider identity, license snapshot, and the mapping’s verification state', async () => {
    const { mappings, contentRecords } = makeStores();
    await seedMapping(mappings);
    await seedContent(contentRecords);
    const query = new GetPlantContent(PROVIDER_KEY, mappings, contentRecords);

    const result = await query.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result.outcome).toBe('available');
    if (result.outcome === 'available') {
      // The identity claim is labeled for what it is: machine-proposed.
      expect(result.mapping.verificationState).toBe('unverified');
      expect(result.mapping.confidence).toBe(0.92);
      expect(result.record.providerKey).toBe(PROVIDER_KEY);
      expect(result.record.licenseNote).toBe('test license: internal use only');
      expect(result.record.presentationNote).toBe('verbatim with attribution');
      expect(result.record.fetchedAt).toEqual(NOW);
    }
  });

  it('stops serving content once the mapping is rejected — rows persist, the identity claim does not', async () => {
    const { mappings, contentRecords } = makeStores();
    const mappingId = await seedMapping(mappings);
    await seedContent(contentRecords);
    const query = new GetPlantContent(PROVIDER_KEY, mappings, contentRecords);

    await mappings.updateVerificationState(
      mappingId,
      'unverified',
      'rejected',
      'wrong species match',
      NOW,
    );

    await expect(query.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID })).resolves.toEqual({
      outcome: 'noContent',
      reason: 'taxonomyNotMapped',
    });
    expect(contentRecords.records).toHaveLength(1);
  });
});
