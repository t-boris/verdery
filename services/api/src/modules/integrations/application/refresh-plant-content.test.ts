/**
 * Provider contract, cache, quota, timeout, replacement, and
 * honest-degradation tests for `RefreshPlantContent` — the content half of
 * P7-INT-02's acceptance evidence ("Provider replacement tests"), over
 * deterministic fakes. The same scenarios run against real PostgreSQL in
 * `tests/integration/integrations-plant-content.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import { createPlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import {
  FakePlantContentProviderAdapter,
  InMemoryPlantContentRecordRepository,
  InMemoryPlantTaxonomyMappingRepository,
  InMemoryProviderQuotaRepository,
  SteppingClock,
  testPlantContent,
  testPlantContentProviderMetadata,
} from './integrations-test-doubles.js';
import type { PlantContentProviderRegistration } from './plant-content-provider-registry.js';
import { PlantContentProviderRegistry } from './plant-content-provider-registry.js';
import type { RefreshPlantContentConfiguration } from './refresh-plant-content.js';
import { RefreshPlantContent } from './refresh-plant-content.js';

const TAXONOMY_REFERENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa101';
const START = new Date('2026-07-25T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const REFETCH = { contentFreshForMs: 24 * HOUR_MS };

interface HarnessOptions {
  readonly registrations?: readonly PlantContentProviderRegistration[];
  readonly activeProviderKey?: string | null;
  readonly refetchPolicy?: typeof REFETCH;
}

function makeHarness(options: HarnessOptions = {}) {
  const clock = new SteppingClock(START);
  const contentRecords = new InMemoryPlantContentRecordRepository();
  const mappings = new InMemoryPlantTaxonomyMappingRepository();
  const providerQuotas = new InMemoryProviderQuotaRepository();
  const registry = new PlantContentProviderRegistry(options.registrations ?? []);
  const configuration: RefreshPlantContentConfiguration = {
    activeProviderKey: options.activeProviderKey ?? null,
    refetchPolicy: options.refetchPolicy ?? REFETCH,
  };
  const refresh = new RefreshPlantContent(
    registry,
    configuration,
    contentRecords,
    mappings,
    providerQuotas,
    clock,
  );
  return { clock, contentRecords, mappings, providerQuotas, registry, refresh };
}

/** A live unverified mapping for `providerKey`, seeded directly — mapping creation is `MapPlantTaxonomy`'s own tested job. */
async function seedMapping(
  mappings: InMemoryPlantTaxonomyMappingRepository,
  providerKey: string,
  providerTaxonId = 'taxon-1001',
): Promise<string> {
  const mapping = createPlantTaxonomyMapping({
    id: generateUuidV7(),
    taxonomyReferenceId: TAXONOMY_REFERENCE_ID,
    rawProviderKey: providerKey,
    rawProviderTaxonId: providerTaxonId,
    providerScientificName: 'Solanum lycopersicum',
    confidence: 0.92,
    now: START,
  });
  await mappings.insert(mapping);
  return mapping.id;
}

function successfulRegistration(providerKey: string): {
  registration: PlantContentProviderRegistration;
  adapter: FakePlantContentProviderAdapter;
} {
  const adapter = new FakePlantContentProviderAdapter(
    { kind: 'succeed', candidates: [] },
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

describe('RefreshPlantContent — the honest no-provider state', () => {
  it('returns a typed noProviderConfigured outcome with nothing stored — never an empty success', async () => {
    const { refresh, contentRecords } = makeHarness();

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });
    expect(contentRecords.records).toHaveLength(0);
  });

  it('rejects a configured active key with no registration loudly, at construction', () => {
    expect(() => makeHarness({ activeProviderKey: 'ghost-provider' })).toThrow(InternalError);
  });

  it('rejects an invalid refetch policy loudly, at construction', () => {
    expect(() => makeHarness({ refetchPolicy: { contentFreshForMs: 0 } })).toThrow(ValidationError);
  });
});

describe('RefreshPlantContent — identity resolution honesty', () => {
  it('returns a typed taxonomyNotMapped outcome instead of guessing a provider taxon', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const { refresh } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'taxonomyNotMapped' });
    expect(adapter.fetchCallCount).toBe(0);
  });

  it('stops resolving content once the mapping is rejected, without touching stored rows', async () => {
    const { registration } = successfulRegistration('fake-plant-provider-a');
    const { refresh, mappings, contentRecords, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });
    const mappingId = await seedMapping(mappings, 'fake-plant-provider-a');
    await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    expect(contentRecords.records).toHaveLength(1);

    // The explicit re-identification event: reject the identity claim.
    await mappings.updateVerificationState(
      mappingId,
      'unverified',
      'rejected',
      'provider reorganized its taxonomy',
      clock.now(),
    );

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'taxonomyNotMapped' });
    // The content rows persist untouched — they are the provider's history,
    // just no longer claiming to be about this reference.
    expect(contentRecords.records).toHaveLength(1);
  });
});

describe('RefreshPlantContent — fetch, normalization, and provenance', () => {
  it('persists a record stamped with the registry entry’s provider key, license, jurisdiction, and presentation terms', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [] },
      { kind: 'succeed', content: testPlantContent() },
    );
    const metadata = testPlantContentProviderMetadata('fake-plant-provider-a', {
      jurisdiction: 'EU',
    });
    const { refresh, mappings, contentRecords, providerQuotas, clock } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result.outcome).toBe('refreshed');
    if (result.outcome === 'refreshed') {
      expect(result.contentChanged).toBe(true);
      expect(result.mapping.providerTaxonId).toBe('taxon-1001');
    }
    expect(adapter.fetchCallCount).toBe(1);
    expect(adapter.lastFetchedTaxonId).toBe('taxon-1001');
    expect(contentRecords.records).toHaveLength(1);
    const record = contentRecords.records[0];
    expect(record?.providerKey).toBe('fake-plant-provider-a');
    expect(record?.providerTaxonId).toBe('taxon-1001');
    expect(record?.licenseNote).toBe(metadata.licenseNote);
    expect(record?.attributionText).toBe(metadata.attributionText);
    expect(record?.jurisdiction).toBe('EU');
    expect(record?.presentationNote).toBe(metadata.presentationNote);
    expect(record?.fetchedAt).toEqual(clock.now());
    expect(providerQuotas.countFor('fake-plant-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('degrades to a typed providerReturnedNoData outcome when the provider has no content for the taxon', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [] },
      { kind: 'succeed', content: null },
    );
    const { refresh, mappings } = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedNoData' });
  });

  it('rejects malformed provider content as a typed outcome and persists nothing', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [] },
      {
        kind: 'succeed',
        content: testPlantContent({ sections: { description: null, careGuidance: null } }),
      },
    );
    const { refresh, mappings, contentRecords } = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedInvalidData' });
    expect(contentRecords.records).toHaveLength(0);
  });
});

describe('RefreshPlantContent — refetch window and version history', () => {
  it('serves the stored record within the refetch window and never refetches', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const { refresh, mappings, clock, providerQuotas } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    clock.advanceMs(REFETCH.contentFreshForMs); // boundary: still current
    const second = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(second.outcome).toBe('contentCurrent');
    expect(adapter.fetchCallCount).toBe(1);
    // The cache hit consumed nothing: only the first call's windows count
    // (asserted at START — the 24h window has since crossed into the next
    // UTC day, where nothing was ever consumed).
    expect(providerQuotas.countFor('fake-plant-provider-a', 'day', START)).toBe(1);
    expect(providerQuotas.countFor('fake-plant-provider-a', 'day', clock.now())).toBe(0);
  });

  it('refetches past the window, appending a new row: version history, contentChanged false when identical', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const { refresh, mappings, contentRecords, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    clock.advanceMs(REFETCH.contentFreshForMs + 1);
    const second = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(second.outcome).toBe('refreshed');
    if (second.outcome === 'refreshed') {
      expect(second.contentChanged).toBe(false);
    }
    expect(adapter.fetchCallCount).toBe(2);
    // Append-only: both fetch facts persist.
    expect(contentRecords.records).toHaveLength(2);
  });

  it('reports contentChanged when the provider ships a new version', async () => {
    const { registration, adapter } = successfulRegistration('fake-plant-provider-a');
    const { refresh, mappings, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    clock.advanceMs(REFETCH.contentFreshForMs + 1);
    adapter.setFetchBehavior({
      kind: 'succeed',
      content: testPlantContent({
        source: {
          providerRecordId: 'content-2001',
          providerContentVersion: 'v2',
          contentLanguage: 'en',
        },
        sections: { description: 'Updated description.', careGuidance: 'Updated guidance.' },
      }),
    });
    const second = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(second.outcome).toBe('refreshed');
    if (second.outcome === 'refreshed') {
      expect(second.contentChanged).toBe(true);
      expect(second.record.source.providerContentVersion).toBe('v2');
    }
  });
});

describe('RefreshPlantContent — degradations serve stored content, labeled', () => {
  it('serves the stored record explicitly labeled with quotaExhausted when the budget refuses', async () => {
    const { adapter } = successfulRegistration('fake-plant-provider-a');
    const metadata = testPlantContentProviderMetadata('fake-plant-provider-a', {
      quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null },
    });
    // A refetch window narrower than the quota window, so the second call is
    // past the window while still inside the same spent UTC hour.
    const narrowWindow = { contentFreshForMs: 10 * 60 * 1000 };
    const { refresh, mappings, clock } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-plant-provider-a',
      refetchPolicy: narrowWindow,
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    clock.advanceMs(narrowWindow.contentFreshForMs + 1);
    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(adapter.fetchCallCount).toBe(1);
    expect(result.outcome).toBe('storedServed');
    if (result.outcome === 'storedServed') {
      expect(result.reason).toBe('quotaExhausted');
      expect(result.record.providerKey).toBe('fake-plant-provider-a');
    }
  });

  it('degrades to a typed providerTimeout outcome when the fetch outlives its strict deadline, keeping the quota consumed', async () => {
    vi.useFakeTimers();
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [] },
      { kind: 'hang' },
    );
    const metadata = testPlantContentProviderMetadata('fake-plant-provider-a', {
      fetchTimeoutMs: 500,
    });
    const { refresh, mappings, providerQuotas, clock } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    const promise = refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerTimeout' });
    expect(adapter.lastSignalAborted).toBe(true);
    expect(providerQuotas.countFor('fake-plant-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('degrades to a typed providerFailed outcome on adapter rejection', async () => {
    const adapter = new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [] },
      { kind: 'fail' },
    );
    const { refresh, mappings } = makeHarness({
      registrations: [
        { metadata: testPlantContentProviderMetadata('fake-plant-provider-a'), adapter },
      ],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(mappings, 'fake-plant-provider-a');

    const result = await refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerFailed' });
  });
});

describe('RefreshPlantContent — provider replacement', () => {
  it('replaces the provider with one registration, one mapping, and a configuration key change, without touching prior records', async () => {
    const a = successfulRegistration('fake-plant-provider-a');
    const b = successfulRegistration('fake-plant-provider-b');
    b.adapter.setFetchBehavior({
      kind: 'succeed',
      content: testPlantContent({
        source: { providerRecordId: 'b-77', providerContentVersion: 'b-v1', contentLanguage: 'en' },
      }),
    });
    const harness = makeHarness({
      registrations: [a.registration, b.registration],
      activeProviderKey: 'fake-plant-provider-a',
    });
    await seedMapping(harness.mappings, 'fake-plant-provider-a');
    await harness.refresh.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    // The "replacement": same registry, same stores, same machinery — only
    // the configured active key changes.
    const replaced = new RefreshPlantContent(
      harness.registry,
      { activeProviderKey: 'fake-plant-provider-b', refetchPolicy: REFETCH },
      harness.contentRecords,
      harness.mappings,
      harness.providerQuotas,
      harness.clock,
    );

    // Provider B has its own taxonomy: the old mapping does not leak — the
    // typed taxonomyNotMapped outcome demands an explicit new identity
    // resolution before any content flows.
    await expect(replaced.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID })).resolves.toEqual(
      { outcome: 'unavailable', reason: 'taxonomyNotMapped' },
    );
    await seedMapping(harness.mappings, 'fake-plant-provider-b', 'b-taxon-42');
    const result = await replaced.execute({ taxonomyReferenceId: TAXONOMY_REFERENCE_ID });

    expect(result.outcome).toBe('refreshed');
    expect(a.adapter.fetchCallCount).toBe(1);
    expect(b.adapter.fetchCallCount).toBe(1);

    // Both providers' records coexist, each with its own provider key and
    // license snapshot; the earlier provider's rows are untouched history —
    // "Provider selection ... does not change domain records silently."
    const byProvider = new Map<string, number>();
    for (const record of harness.contentRecords.records) {
      byProvider.set(record.providerKey, (byProvider.get(record.providerKey) ?? 0) + 1);
    }
    expect(byProvider.get('fake-plant-provider-a')).toBe(1);
    expect(byProvider.get('fake-plant-provider-b')).toBe(1);
    const priorRecord = harness.contentRecords.records[0];
    expect(priorRecord?.licenseNote).toBe(a.registration.metadata.licenseNote);
    expect(priorRecord?.providerTaxonId).toBe('taxon-1001');
    // Provider A's mapping is untouched: replacement is additive, and
    // switching back would find it exactly as it was.
    await expect(
      harness.mappings.findLive('fake-plant-provider-a', TAXONOMY_REFERENCE_ID),
    ).resolves.toMatchObject({ providerTaxonId: 'taxon-1001' });
  });
});
