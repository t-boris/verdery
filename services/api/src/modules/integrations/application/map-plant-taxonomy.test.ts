/**
 * Provider contract, idempotency, quota, timeout, and honest-degradation
 * tests for `MapPlantTaxonomy` — the identity half of P7-INT-02's
 * acceptance evidence, over deterministic fakes. The same scenarios run
 * against real PostgreSQL in
 * `tests/integration/integrations-plant-content.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { PlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import {
  FakePlantContentProviderAdapter,
  FakeTaxonomyIdentitySource,
  InMemoryPlantTaxonomyMappingRepository,
  InMemoryProviderQuotaRepository,
  SteppingClock,
  testPlantContent,
  testPlantContentProviderMetadata,
  testTaxonCandidate,
  testTaxonomyReference,
} from './integrations-test-doubles.js';
import { MapPlantTaxonomy } from './map-plant-taxonomy.js';
import type { PlantContentProviderRegistration } from './plant-content-provider-registry.js';
import { PlantContentProviderRegistry } from './plant-content-provider-registry.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';

const TAXONOMY_REFERENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa001';
const START = new Date('2026-07-25T12:00:00Z');

interface HarnessOptions {
  readonly registrations?: readonly PlantContentProviderRegistration[];
  readonly activeProviderKey?: string | null;
  readonly referenceKnown?: boolean;
  readonly mappings?: PlantTaxonomyMappingRepository;
}

function makeHarness(options: HarnessOptions = {}) {
  const clock = new SteppingClock(START);
  const mappings = new InMemoryPlantTaxonomyMappingRepository();
  const providerQuotas = new InMemoryProviderQuotaRepository();
  const taxonomyIdentities = new FakeTaxonomyIdentitySource();
  if (options.referenceKnown !== false) {
    taxonomyIdentities.set(testTaxonomyReference(TAXONOMY_REFERENCE_ID));
  }
  const registry = new PlantContentProviderRegistry(options.registrations ?? []);
  const map = new MapPlantTaxonomy(
    registry,
    { activeProviderKey: options.activeProviderKey ?? null },
    options.mappings ?? mappings,
    taxonomyIdentities,
    providerQuotas,
    clock,
  );
  return { clock, mappings, providerQuotas, taxonomyIdentities, registry, map };
}

function successfulRegistration(providerKey: string): {
  registration: PlantContentProviderRegistration;
  adapter: FakePlantContentProviderAdapter;
} {
  const adapter = new FakePlantContentProviderAdapter(
    { kind: 'succeed', candidates: [testTaxonCandidate()] },
    { kind: 'succeed', content: testPlantContent() },
  );
  return {
    registration: { metadata: testPlantContentProviderMetadata(providerKey), adapter },
    adapter,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MapPlantTaxonomy — the honest no-provider state', () => {
  it('returns a typed noProviderConfigured outcome with nothing stored — never an empty success', async () => {
    const { map, mappings } = makeHarness();

    const result = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });
    expect(mappings.mappings).toHaveLength(0);
  });

  it('rejects a configured active key with no registration loudly, at construction', () => {
    expect(() => makeHarness({ activeProviderKey: 'ghost-provider' })).toThrow(InternalError);
  });
});

describe('MapPlantTaxonomy — mapping and provenance', () => {
  it('persists an UNVERIFIED mapping carrying the provider identity, its confidence, and its name snapshot', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const { map, mappings, providerQuotas, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });

    const result = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result.outcome).toBe('mapped');
    expect(adapter.searchCallCount).toBe(1);
    // The search is phrased with the catalog's own identity facts.
    expect(adapter.lastSearchQuery).toEqual({
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomato',
    });
    expect(mappings.mappings).toHaveLength(1);
    const mapping = mappings.mappings[0] as PlantTaxonomyMapping;
    expect(mapping.taxonomyReferenceId).toBe(TAXONOMY_REFERENCE_ID);
    expect(mapping.providerKey).toBe('fake-plant-provider-a');
    expect(mapping.providerTaxonId).toBe('taxon-1001');
    expect(mapping.providerScientificName).toBe('Solanum lycopersicum');
    expect(mapping.confidence).toBe(0.92);
    expect(mapping.verificationState).toBe('unverified');
    expect(providerQuotas.countFor('fake-plant-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('is repeat-safe: an already-mapped reference is an alreadyMapped no-op that never touches the provider', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const { map, providerQuotas, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });

    const first = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    const second = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(first.outcome).toBe('mapped');
    expect(second.outcome).toBe('alreadyMapped');
    if (first.outcome === 'mapped' && second.outcome === 'alreadyMapped') {
      expect(second.mapping.id).toBe(first.mapping.id);
    }
    expect(adapter.searchCallCount).toBe(1);
    expect(providerQuotas.countFor('fake-plant-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('picks the highest provider-reported confidence deterministically, null confidences losing to any number', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      {
        kind: 'succeed',
        candidates: [
          testTaxonCandidate({ providerTaxonId: 'taxon-null', confidence: null }),
          testTaxonCandidate({ providerTaxonId: 'taxon-low', confidence: 0.4 }),
          testTaxonCandidate({ providerTaxonId: 'taxon-high', confidence: 0.9 }),
          testTaxonCandidate({ providerTaxonId: 'taxon-tied', confidence: 0.9 }),
        ],
      },
      { kind: 'succeed', content: testPlantContent() },
    );
    const { map, mappings } = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });

    await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    // 0.9 wins; the tie resolves to the provider's own result order.
    expect(mappings.mappings[0]?.providerTaxonId).toBe('taxon-high');
  });

  it('falls back to the provider result order when no candidate carries a confidence', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      {
        kind: 'succeed',
        candidates: [
          testTaxonCandidate({ providerTaxonId: 'taxon-first', confidence: null }),
          testTaxonCandidate({ providerTaxonId: 'taxon-second', confidence: null }),
        ],
      },
      { kind: 'succeed', content: testPlantContent() },
    );
    const { map, mappings } = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });

    await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(mappings.mappings[0]?.providerTaxonId).toBe('taxon-first');
    expect(mappings.mappings[0]?.confidence).toBeNull();
  });

  it('returns alreadyMapped with the winner when a concurrent mapper wins the live-uniqueness race', async () => {
    const { registration } = successfulRegistration('fake-plant-provider-a');
    const inner = new InMemoryPlantTaxonomyMappingRepository();
    // The concurrent winner's live mapping — present in storage the whole
    // time, but hidden from this caller's FIRST lookup so its insert lands
    // inside the race window and loses to the live-uniqueness guard.
    await inner.insert({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa002',
      taxonomyReferenceId: TAXONOMY_REFERENCE_ID,
      providerKey: 'fake-plant-provider-a',
      providerTaxonId: 'taxon-9999',
      providerScientificName: null,
      confidence: null,
      verificationState: 'unverified',
      stateNote: null,
      stateChangedAt: START,
      createdAt: START,
    });
    let firstLookup = true;
    const racedRepository: PlantTaxonomyMappingRepository = {
      findLive(providerKey, taxonomyReferenceId) {
        if (firstLookup) {
          firstLookup = false;
          return Promise.resolve(null);
        }
        return inner.findLive(providerKey, taxonomyReferenceId);
      },
      insert: (mapping) => inner.insert(mapping),
      updateVerificationState: (...args) => inner.updateVerificationState(...args),
    };
    const { map } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
      mappings: racedRepository,
    });

    const result = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result.outcome).toBe('alreadyMapped');
    if (result.outcome === 'alreadyMapped') {
      expect(result.mapping.providerTaxonId).toBe('taxon-9999');
    }
    // The loser's insert stored nothing.
    expect(inner.mappings).toHaveLength(1);
  });
});

describe('MapPlantTaxonomy — honest degradations', () => {
  it('returns a typed taxonomyReferenceNotFound outcome for an unknown reference', async () => {
    const { registration } = successfulRegistration('fake-plant-provider-a');
    const { map } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
      referenceKnown: false,
    });

    const result = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'taxonomyReferenceNotFound' });
  });

  it('refuses a call over budget as a typed quotaExhausted degradation', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const metadata = testPlantContentProviderMetadata('fake-plant-provider-a', {
      quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null },
    });
    const { map, providerQuotas, clock } = makeHarness({
      registrations: [{ metadata, adapter: registration.adapter }],
      activeProviderKey: 'fake-plant-provider-a',
    });
    // Spend the budget on an unrelated call in the same window.
    await providerQuotas.consumeCall('fake-plant-provider-a', metadata.quotaLimits, clock.now());

    const result = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'quotaExhausted' });
    expect(adapter.searchCallCount).toBe(0);
  });

  it('degrades to a typed providerTimeout outcome when the search outlives its strict deadline, keeping the quota consumed', async () => {
    vi.useFakeTimers();
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'hang' },
      { kind: 'succeed', content: testPlantContent() },
    );
    const metadata = testPlantContentProviderMetadata('fake-plant-provider-a', {
      fetchTimeoutMs: 500,
    });
    const { map, providerQuotas, clock } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-plant-provider-a',
    });

    const promise = map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerTimeout' });
    expect(adapter.lastSignalAborted).toBe(true);
    // The call was made: its quota consumption stands.
    expect(providerQuotas.countFor('fake-plant-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('degrades to typed providerFailed / providerReturnedNoMatch outcomes', async () => {
    const failing = new FakePlantContentProviderAdapter(
      { kind: 'fail' },
      { kind: 'succeed', content: testPlantContent() },
    );
    const failed = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter: failing },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await expect(
      failed.map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID }),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'providerFailed' });

    const empty = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [] },
      { kind: 'succeed', content: testPlantContent() },
    );
    const noMatch = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter: empty },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await expect(
      noMatch.map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID }),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'providerReturnedNoMatch' });
  });

  it('rejects a malformed candidate as a typed outcome and persists nothing', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [testTaxonCandidate({ confidence: 1.5 })] },
      { kind: 'succeed', content: testPlantContent() },
    );
    const { map, mappings } = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });

    const result = await map.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedInvalidData' });
    expect(mappings.mappings).toHaveLength(0);
  });
});
