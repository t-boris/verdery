import { describe, expect, it } from 'vitest';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import {
  fixedClock,
  InMemoryPlantTaxonomyMappingRepository,
  InMemoryProviderQuotaRepository,
  FakeTaxonomyIdentitySource,
} from './integrations-test-doubles.js';
import { PlantAssertionProviderRegistry } from './plant-assertion-provider-registry.js';
import {
  FakePlantAssertionProviderAdapter,
  InMemoryPlantDistributionAssertionRepository,
  InMemoryPlantMediaAssetRepository,
  InMemoryPlantFactAssertionRepository,
  sequentialIdGenerator,
} from './plant-assertion-provider-test-doubles.js';
import type { FakeAssertionTaxaSearchBehavior } from './plant-assertion-provider-test-doubles.js';
import { RefreshTaxonAssertions } from './refresh-taxon-assertions.js';
import type { PlantAssertionProviderMetadata } from './plant-assertion-provider-registry.js';

const NOW = new Date('2026-07-31T12:00:00Z');
const TAXONOMY_ID: Uuid = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PROVIDER_KEY = 'usda-plants';

function metadata(
  overrides: Partial<PlantAssertionProviderMetadata> = {},
): PlantAssertionProviderMetadata {
  return {
    providerKey: PROVIDER_KEY,
    displayName: 'USDA PLANTS Database',
    licenseNote: 'Public domain test license.',
    citationText: 'USDA NRCS PLANTS Database. https://plants.usda.gov.',
    attributionText: null,
    fetchTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    ...overrides,
  };
}

function harness(
  options: {
    searchBehavior?: FakeAssertionTaxaSearchBehavior;
    registered?: boolean;
    quotaLimits?: { maxCallsPerHour: number | null; maxCallsPerDay: number | null };
  } = {},
) {
  const adapter = new FakePlantAssertionProviderAdapter(
    options.searchBehavior ?? {
      kind: 'succeed',
      candidates: [{ providerTaxonId: '70172', scientificName: 'Quercus alba', confidence: null }],
    },
    { kind: 'succeed', value: [] },
    { kind: 'succeed', value: [] },
  );
  const registry = new PlantAssertionProviderRegistry(
    options.registered === false
      ? []
      : [
          {
            metadata: metadata(
              options.quotaLimits === undefined ? {} : { quotaLimits: options.quotaLimits },
            ),
            adapter,
          },
        ],
  );
  const mappings = new InMemoryPlantTaxonomyMappingRepository();
  const taxonomyIdentities = new FakeTaxonomyIdentitySource();
  taxonomyIdentities.set({
    id: TAXONOMY_ID,
    scientificName: 'Quercus alba',
    commonName: 'White oak',
    varietyName: null,
    family: null,
    genus: null,
    source: 'system_catalog',
    createdByProfileId: null,
    createdAt: NOW,
  });
  const facts = new InMemoryPlantFactAssertionRepository();
  const distributionAssertions = new InMemoryPlantDistributionAssertionRepository();
  const mediaAssets = new InMemoryPlantMediaAssetRepository();
  const providerQuotas = new InMemoryProviderQuotaRepository();
  const refresh = new RefreshTaxonAssertions(
    registry,
    mappings,
    taxonomyIdentities,
    facts,
    distributionAssertions,
    mediaAssets,
    providerQuotas,
    sequentialIdGenerator('assertion'),
    fixedClock(NOW),
  );
  return { refresh, adapter, mappings, facts, distributionAssertions, mediaAssets, providerQuotas };
}

describe('RefreshTaxonAssertions', () => {
  it('resolves a mapping via searchTaxa when none exists, then fetches and persists facts/distribution', async () => {
    const { refresh, adapter, mappings, facts, distributionAssertions } = harness();
    adapter.setFactsBehavior({
      kind: 'succeed',
      value: [
        {
          factKey: 'growth_habit',
          value: 'Tree',
          unit: null,
          confidence: null,
          geographicScope: null,
        },
      ],
    });
    adapter.setDistributionBehavior({
      kind: 'succeed',
      value: [{ region: 'L48', rawStatus: 'native', confidence: null }],
    });

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toMatchObject({ outcome: 'refreshed', factsWritten: 1, distributionWritten: 1 });
    expect(adapter.searchCallCount).toBe(1);
    expect(mappings.mappings).toHaveLength(1);
    expect(mappings.mappings[0]).toMatchObject({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
      providerTaxonId: '70172',
      verificationState: 'unverified',
    });

    expect(facts.assertions[0]).toMatchObject({
      providerTaxonId: '70172',
      factKey: 'growth_habit',
      factValue: 'Tree',
      provenance: {
        authoringMethod: 'ai_extracted_from_source',
        providerKey: PROVIDER_KEY,
        reviewStatus: 'awaiting_horticultural_review',
      },
    });
    expect(distributionAssertions.assertions).toHaveLength(1);
    expect(distributionAssertions.assertions[0]).toMatchObject({
      providerTaxonId: '70172',
      region: 'L48',
      status: 'native',
      provenance: { reviewStatus: 'awaiting_horticultural_review' },
    });
  });

  it('reuses an existing live mapping without calling searchTaxa again', async () => {
    const { refresh, adapter, mappings } = harness();
    const first = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });
    expect(first.outcome).toBe('refreshed');
    expect(adapter.searchCallCount).toBe(1);
    expect(mappings.mappings).toHaveLength(1);

    const second = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(second.outcome).toBe('refreshed');
    expect(adapter.searchCallCount).toBe(1);
    expect(mappings.mappings).toHaveLength(1);
  });

  it('reports providerNotRegistered when the provider key is not in the registry', async () => {
    const { refresh } = harness({ registered: false });

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerNotRegistered' });
  });

  it('reports taxonomyReferenceNotFound for an unknown taxon', async () => {
    const { refresh } = harness();

    const result = await refresh.execute({
      taxonomyReferenceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99',
      providerKey: PROVIDER_KEY,
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'taxonomyReferenceNotFound' });
  });

  it('reports providerReturnedNoMatch when the search finds nothing', async () => {
    const { refresh } = harness({ searchBehavior: { kind: 'succeed', candidates: [] } });

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedNoMatch' });
  });

  it('reports quotaExhausted and never calls the provider once the budget is spent', async () => {
    const quotaLimits = { maxCallsPerHour: 1, maxCallsPerDay: null };
    const { refresh, adapter, providerQuotas } = harness({ quotaLimits });
    // Spends the only slot before the use case ever runs, mirroring a
    // concurrent caller having already consumed it.
    const preSpent = await providerQuotas.consumeCall(PROVIDER_KEY, quotaLimits, NOW);
    expect(preSpent.consumed).toBe(true);

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'quotaExhausted' });
    expect(adapter.searchCallCount).toBe(0);
  });

  it('reports providerFailed when fetchFacts rejects after a mapping already exists', async () => {
    const { refresh, adapter } = harness();
    await refresh.execute({ taxonomyReferenceId: TAXONOMY_ID, providerKey: PROVIDER_KEY });
    adapter.setFactsBehavior({ kind: 'fail', error: new Error('boom') });

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerFailed' });
  });

  it('rejects a malformed provider payload before writing any assertions', async () => {
    const { refresh, adapter, facts, distributionAssertions } = harness();
    adapter.setFactsBehavior({
      kind: 'succeed',
      value: [
        {
          factKey: 'growth_habit',
          value: 'Tree',
          unit: null,
          confidence: null,
          geographicScope: null,
        },
        {
          // Provider extraction may report this field, but the domain
          // requires toxicity claims to be human-authored.
          factKey: 'toxicity',
          value: 'None',
          unit: null,
          confidence: null,
          geographicScope: null,
        },
      ],
    });
    adapter.setDistributionBehavior({
      kind: 'succeed',
      value: [{ region: 'L48', rawStatus: 'native', confidence: null }],
    });

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedInvalidData' });
    expect(facts.assertions).toEqual([]);
    expect(distributionAssertions.assertions).toEqual([]);
  });

  it('stores every image the provider offers, refused ones marked refused', async () => {
    const { refresh, adapter, mediaAssets } = harness({});
    adapter.mediaBehavior = {
      kind: 'succeed',
      value: [
        {
          providerAssetId: '1:0',
          sourceUrl: 'https://example.org/usable.jpg',
          rawLicence: 'http://creativecommons.org/publicdomain/zero/1.0/',
          rightsHolder: null,
          creator: 'A. Botanist',
          observedAt: null,
        },
        {
          providerAssetId: '1:1',
          sourceUrl: 'https://example.org/non-commercial.jpg',
          rawLicence: 'http://creativecommons.org/licenses/by-nc/4.0/',
          rightsHolder: 'Someone Else',
          creator: null,
          observedAt: null,
        },
      ],
    };

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result.outcome).toBe('refreshed');
    // Both stored: "this taxon has no photographs" and "its photographs are
    // all non-commercial" are different answers, and only the second says to
    // look for another source.
    const stored = [...mediaAssets.assets.values()].map((entry) => entry.asset);
    expect(stored.map((asset) => asset.ingestionState).sort()).toEqual(['discovered', 'rejected']);
    expect(stored.find((asset) => asset.license === 'cc_by_nc')?.ingestionState).toBe('rejected');
  });

  it('keeps a refresh that already wrote facts when the media call fails', async () => {
    // Losing real horticultural facts because a picture request timed out
    // would trade data for imagery.
    const { refresh, adapter, mediaAssets } = harness({});

    adapter.mediaBehavior = { kind: 'fail' };

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result.outcome).toBe('refreshed');
    expect(mediaAssets.assets.size).toBe(0);
  });

  it('discards a malformed media batch without keeping earlier assets', async () => {
    const { refresh, adapter, mediaAssets } = harness({});
    adapter.mediaBehavior = {
      kind: 'succeed',
      value: [
        {
          providerAssetId: '1:0',
          sourceUrl: 'https://example.org/usable.jpg',
          rawLicence: 'http://creativecommons.org/publicdomain/zero/1.0/',
          rightsHolder: null,
          creator: 'A. Botanist',
          observedAt: null,
        },
        {
          providerAssetId: '1:1',
          sourceUrl: '',
          rawLicence: 'http://creativecommons.org/publicdomain/zero/1.0/',
          rightsHolder: null,
          creator: 'A. Botanist',
          observedAt: null,
        },
      ],
    };

    const result = await refresh.execute({
      taxonomyReferenceId: TAXONOMY_ID,
      providerKey: PROVIDER_KEY,
    });

    expect(result).toMatchObject({ outcome: 'refreshed', mediaWritten: 0 });
    expect(mediaAssets.assets.size).toBe(0);
  });
});
