import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonomyReference } from '../../plants-inventory/public.js';
import type { PlantContentRecord } from '../domain/plant-content-record.js';
import type {
  PlantTaxonomyMapping,
  TaxonomyMappingVerificationState,
} from '../domain/plant-taxonomy-mapping.js';
import type {
  NormalizedPlantContent,
  PlantContentProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from './plant-content-provider.js';
import type { PlantContentProviderMetadata } from './plant-content-provider-registry.js';
import type { PlantContentRecordRepository } from './plant-content-record-repository.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';
import type { TaxonomyIdentitySource } from './taxonomy-identity-source.js';

/**
 * Plant-content test doubles — the fakes backing this module's taxonomy and
 * content half.
 *
 * Split out of `integrations-test-doubles.ts` for the repository's own
 * 600-line rule. The boundary is the capability, not an arbitrary line
 * count: everything here concerns provider taxonomy and licensed content,
 * while the file it came from now holds clocks, weather and quota. Both are
 * re-exported from `integrations-test-doubles.ts`, so no test import
 * changes.
 */

export type FakeTaxonSearchBehavior =
  | { readonly kind: 'succeed'; readonly candidates: readonly ProviderTaxonCandidate[] }
  | { readonly kind: 'fail'; readonly error?: unknown }
  /** Never settles until the deadline's abort — the timeout scenario. */
  | { readonly kind: 'hang' };

export type FakeContentFetchBehavior =
  | { readonly kind: 'succeed'; readonly content: NormalizedPlantContent | null }
  | { readonly kind: 'fail'; readonly error?: unknown }
  | { readonly kind: 'hang' };

/**
 * A scriptable plant-content adapter. The per-operation call counts are the
 * load-bearing assertion surface: idempotency and cache tests prove "never
 * calls the provider again" by them staying flat.
 */
export class FakePlantContentProviderAdapter implements PlantContentProviderAdapter {
  searchCallCount = 0;
  fetchCallCount = 0;
  lastSearchQuery: TaxonomyIdentityQuery | null = null;
  lastFetchedTaxonId: string | null = null;
  lastSignalAborted: boolean | null = null;

  constructor(
    private searchBehavior: FakeTaxonSearchBehavior,
    private fetchBehavior: FakeContentFetchBehavior,
  ) {}

  setSearchBehavior(behavior: FakeTaxonSearchBehavior): void {
    this.searchBehavior = behavior;
  }

  setFetchBehavior(behavior: FakeContentFetchBehavior): void {
    this.fetchBehavior = behavior;
  }

  searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]> {
    this.searchCallCount += 1;
    this.lastSearchQuery = query;
    const behavior = this.searchBehavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve(behavior.candidates);
      case 'fail':
        return Promise.reject(toError(behavior.error));
      case 'hang':
        return this.hang(signal);
    }
  }

  fetchContent(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<NormalizedPlantContent | null> {
    this.fetchCallCount += 1;
    this.lastFetchedTaxonId = providerTaxonId;
    const behavior = this.fetchBehavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve(behavior.content);
      case 'fail':
        return Promise.reject(toError(behavior.error));
      case 'hang':
        return this.hang(signal);
    }
  }

  private hang<T>(signal: AbortSignal): Promise<T> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        this.lastSignalAborted = true;
        reject(new Error('aborted by deadline'));
      });
    });
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('fake provider failure', { cause: error });
}

export class InMemoryPlantContentRecordRepository implements PlantContentRecordRepository {
  readonly records: PlantContentRecord[] = [];

  insert(record: PlantContentRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }

  findLatest(providerKey: string, providerTaxonId: string): Promise<PlantContentRecord | null> {
    const matching = this.records
      .filter(
        (record) =>
          record.providerKey === providerKey && record.providerTaxonId === providerTaxonId,
      )
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    return Promise.resolve(matching[0] ?? null);
  }
}

/** Mirrors the Kysely adapter's semantics: live-uniqueness on insert (`false`, nothing stored), state-guarded transition updates. */
export class InMemoryPlantTaxonomyMappingRepository implements PlantTaxonomyMappingRepository {
  readonly mappings: PlantTaxonomyMapping[] = [];

  insert(mapping: PlantTaxonomyMapping): Promise<boolean> {
    const liveExists = this.mappings.some(
      (existing) =>
        existing.providerKey === mapping.providerKey &&
        existing.taxonomyReferenceId === mapping.taxonomyReferenceId &&
        existing.verificationState !== 'rejected',
    );
    if (liveExists) {
      return Promise.resolve(false);
    }
    this.mappings.push(mapping);
    return Promise.resolve(true);
  }

  findLive(providerKey: string, taxonomyReferenceId: Uuid): Promise<PlantTaxonomyMapping | null> {
    const live = this.mappings.find(
      (mapping) =>
        mapping.providerKey === providerKey &&
        mapping.taxonomyReferenceId === taxonomyReferenceId &&
        mapping.verificationState !== 'rejected',
    );
    return Promise.resolve(live ?? null);
  }

  findByProviderIdentity(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantTaxonomyMapping[]> {
    const matching = this.mappings.filter(
      (mapping) =>
        mapping.providerKey === providerKey &&
        mapping.providerTaxonId === providerTaxonId &&
        mapping.verificationState !== 'rejected',
    );
    return Promise.resolve(matching);
  }

  updateVerificationState(
    mappingId: Uuid,
    expectedCurrentState: TaxonomyMappingVerificationState,
    nextState: TaxonomyMappingVerificationState,
    stateNote: string | null,
    stateChangedAt: Date,
  ): Promise<boolean> {
    const index = this.mappings.findIndex(
      (mapping) => mapping.id === mappingId && mapping.verificationState === expectedCurrentState,
    );
    if (index === -1) {
      return Promise.resolve(false);
    }
    const current = this.mappings[index] as PlantTaxonomyMapping;
    this.mappings[index] = {
      ...current,
      verificationState: nextState,
      stateNote,
      stateChangedAt,
    };
    return Promise.resolve(true);
  }
}

export class FakeTaxonomyIdentitySource implements TaxonomyIdentitySource {
  private readonly byId = new Map<Uuid, TaxonomyReference>();

  set(reference: TaxonomyReference): void {
    this.byId.set(reference.id, reference);
  }

  findById(taxonomyReferenceId: Uuid): Promise<TaxonomyReference | null> {
    return Promise.resolve(this.byId.get(taxonomyReferenceId) ?? null);
  }
}

/** A minimal catalog row — only the identity facts matter to this module. */
export function testTaxonomyReference(
  id: Uuid,
  overrides: Partial<Omit<TaxonomyReference, 'id'>> = {},
): TaxonomyReference {
  return {
    id,
    scientificName: 'Solanum lycopersicum',
    commonName: 'Tomato',
    varietyName: null,
    family: null,
    genus: null,
    source: 'system_catalog',
    createdByProfileId: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

/** A complete, valid candidate — override per test. */
export function testTaxonCandidate(
  overrides: Partial<ProviderTaxonCandidate> = {},
): ProviderTaxonCandidate {
  return {
    providerTaxonId: 'taxon-1001',
    scientificName: 'Solanum lycopersicum',
    confidence: 0.92,
    ...overrides,
  };
}

/** A complete, valid content payload — override per test. */
export function testPlantContent(
  overrides: Partial<NormalizedPlantContent> = {},
): NormalizedPlantContent {
  return {
    source: {
      providerRecordId: 'content-2001',
      providerContentVersion: 'v1',
      contentLanguage: 'en',
    },
    sections: {
      description: 'A warm-season fruiting vegetable.',
      careGuidance: 'Water regularly; avoid wetting foliage.',
    },
    ...overrides,
  };
}

/** Valid plant-content metadata for a fake registration — override per test. Unlimited quota unless a test narrows it. */
export function testPlantContentProviderMetadata(
  providerKey: string,
  overrides: Partial<Omit<PlantContentProviderMetadata, 'providerKey'>> = {},
): PlantContentProviderMetadata {
  return {
    providerKey,
    displayName: `Fake plant-content provider ${providerKey}`,
    licenseNote: `${providerKey} test license: internal use only`,
    attributionText: `Plant content by ${providerKey}`,
    jurisdiction: null,
    presentationNote: `${providerKey} test terms: verbatim with attribution`,
    fetchTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    ...overrides,
  };
}
