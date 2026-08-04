/**
 * Shared deterministic test doubles for this module's unit and integration tests — the same
 * "one shared file, not N copies" reasoning `media/application/media-test-doubles.ts` documents.
 * The fake weather and plant-content adapters here are the module's ONLY adapter
 * implementations: no real vendor exists for either capability (P0-PROV-01 undecided), and these
 * fakes are what proves the port/registry machinery is provider-agnostic — the replacement tests
 * run two of them through identical machinery. Not itself a `*.test.ts` file, so vitest never
 * runs it as a suite.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { Georeference, GeoreferenceReader } from '../../gardens-mapping/public.js';
import type { TaxonomyReference } from '../../plants-inventory/public.js';
import type { PlantContentRecord } from '../domain/plant-content-record.js';
import type {
  PlantTaxonomyMapping,
  TaxonomyMappingVerificationState,
} from '../domain/plant-taxonomy-mapping.js';
import type { WeatherRecord, WeatherRecordKind } from '../domain/weather-record.js';
import type {
  AiExplanationAdapterOutcome,
  AiExplanationModelIdentity,
  AiExplanationProviderAdapter,
  AiExplanationRequest,
} from './ai-explanation-provider.js';
import type {
  NormalizedPlantContent,
  PlantContentProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from './plant-content-provider.js';
import type { PlantContentProviderMetadata } from './plant-content-provider-registry.js';
import type { PlantContentRecordRepository } from './plant-content-record-repository.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';
import type {
  ProviderQuotaConsumeResult,
  ProviderQuotaLimits,
  ProviderQuotaRepository,
  ProviderQuotaWindowKind,
} from './provider-quota-repository.js';
import { quotaWindowStart } from './provider-quota-repository.js';
import type { TaxonomyIdentitySource } from './taxonomy-identity-source.js';
import type { NormalizedWeatherReading, WeatherProviderAdapter } from './weather-provider.js';
import type { WeatherProviderMetadata } from './weather-provider-registry.js';
import type { WeatherRecordRepository } from './weather-record-repository.js';
import type {
  TransactionalEmailAdapter,
  TransactionalEmailMessage,
  TransactionalEmailSendResult,
} from './transactional-email-provider.js';

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

/** A clock a test advances explicitly — for cache-window and staleness scenarios. */
export class SteppingClock implements Clock {
  constructor(private at: Date) {}

  now(): Date {
    return this.at;
  }

  advanceMs(byMs: number): void {
    this.at = new Date(this.at.getTime() + byMs);
  }
}

export type FakeWeatherBehavior =
  | { readonly kind: 'succeed'; readonly readings: readonly NormalizedWeatherReading[] }
  | { readonly kind: 'fail'; readonly error?: unknown }
  /** Never settles until the deadline's abort — the timeout scenario. */
  | { readonly kind: 'hang' };

/**
 * A scriptable adapter. `callCount` is the load-bearing assertion surface:
 * the cache tests prove "never refetches" by it staying at zero/one.
 */
export class FakeWeatherProviderAdapter implements WeatherProviderAdapter {
  callCount = 0;
  lastSignalAborted: boolean | null = null;

  constructor(private behavior: FakeWeatherBehavior) {}

  setBehavior(behavior: FakeWeatherBehavior): void {
    this.behavior = behavior;
  }

  fetchWeather(
    _location: { latitude: number; longitude: number },
    signal: AbortSignal,
  ): Promise<readonly NormalizedWeatherReading[]> {
    this.callCount += 1;
    const behavior = this.behavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve(behavior.readings);
      case 'fail':
        return Promise.reject(
          behavior.error instanceof Error
            ? behavior.error
            : new Error('fake provider failure', { cause: behavior.error }),
        );
      case 'hang':
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            this.lastSignalAborted = true;
            reject(new Error('aborted by deadline'));
          });
        });
    }
  }
}

export class InMemoryWeatherRecordRepository implements WeatherRecordRepository {
  readonly records: WeatherRecord[] = [];

  insertMany(records: readonly WeatherRecord[]): Promise<void> {
    this.records.push(...records);
    return Promise.resolve();
  }

  findLatest(gardenId: Uuid, kind: WeatherRecordKind): Promise<WeatherRecord | null> {
    const matching = this.records
      .filter((record) => record.gardenId === gardenId && record.kind === kind)
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    return Promise.resolve(matching[0] ?? null);
  }
}

/** Mirrors the Kysely adapter's semantics: count both windows atomically, refuse on the first exhausted one, count even unlimited windows. */
export class InMemoryProviderQuotaRepository implements ProviderQuotaRepository {
  readonly counts = new Map<string, number>();

  consumeCall(
    providerKey: string,
    limits: ProviderQuotaLimits,
    now: Date,
  ): Promise<ProviderQuotaConsumeResult> {
    const windows: readonly { kind: ProviderQuotaWindowKind; limit: number | null }[] = [
      { kind: 'hour', limit: limits.maxCallsPerHour },
      { kind: 'day', limit: limits.maxCallsPerDay },
    ];
    for (const window of windows) {
      const key = this.windowKey(providerKey, window.kind, now);
      if (window.limit !== null && (this.counts.get(key) ?? 0) >= window.limit) {
        return Promise.resolve({ consumed: false, exhaustedWindow: window.kind });
      }
    }
    for (const window of windows) {
      const key = this.windowKey(providerKey, window.kind, now);
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    }
    return Promise.resolve({ consumed: true });
  }

  countFor(providerKey: string, kind: ProviderQuotaWindowKind, now: Date): number {
    return this.counts.get(this.windowKey(providerKey, kind, now)) ?? 0;
  }

  private windowKey(providerKey: string, kind: ProviderQuotaWindowKind, now: Date): string {
    return `${providerKey}|${kind}|${String(quotaWindowStart(kind, now).getTime())}`;
  }
}

export class FakeGeoreferenceRepository implements GeoreferenceReader {
  private readonly byGarden = new Map<Uuid, Georeference>();

  setCurrent(georeference: Georeference): void {
    this.byGarden.set(georeference.gardenId, georeference);
  }

  findCurrentForGarden(gardenId: Uuid): Promise<Georeference | null> {
    return Promise.resolve(this.byGarden.get(gardenId) ?? null);
  }
}

/** A minimal current georeference anchored at [longitude, latitude] — only the anchor matters to this module. */
export function testGeoreference(
  gardenId: Uuid,
  longitude: number,
  latitude: number,
): Georeference {
  return {
    id: `${gardenId}-georeference`,
    gardenId,
    coordinateSpaceId: `${gardenId}-space`,
    localAnchor: [0, 0],
    geographicAnchor: [longitude, latitude],
    rotationDegrees: 0,
    scaleCorrection: 1,
    accuracyMetres: null,
    provenance: 'userMeasurement',
    method: 'test-fixture',
    revision: 1,
  };
}

/** A complete, valid single-observation reading — override per test. */
export function testReading(
  overrides: Partial<NormalizedWeatherReading> = {},
): NormalizedWeatherReading {
  return {
    kind: 'observation',
    effectiveAt: new Date('2026-07-25T11:55:00Z'),
    measurements: {
      temperatureCelsius: 21.4,
      precipitationMm: 0.2,
      windSpeedMps: 3.1,
      humidityPercent: 64,
    },
    sourceUnits: {
      temperature: 'celsius',
      precipitation: 'millimetre',
      windSpeed: 'metre_per_second',
      humidity: 'percent',
    },
    quality: { confidence: 0.9, label: null },
    ...overrides,
  };
}

/** Valid metadata for a fake registration — override per test. Unlimited quota unless a test narrows it. */
export function testProviderMetadata(
  providerKey: string,
  overrides: Partial<Omit<WeatherProviderMetadata, 'providerKey'>> = {},
): WeatherProviderMetadata {
  return {
    providerKey,
    displayName: `Fake provider ${providerKey}`,
    licenseNote: `${providerKey} test license: internal use only`,
    attributionText: `Weather by ${providerKey}`,
    fetchTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    ...overrides,
  };
}

// --- Plant-content doubles (P7-INT-02) ---------------------------------------

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

export type FakeAiExplanationBehavior =
  | { readonly kind: 'outcome'; readonly outcome: AiExplanationAdapterOutcome }
  | { readonly kind: 'fail'; readonly error?: unknown }
  /** Never settles until the deadline's abort — the timeout scenario. */
  | { readonly kind: 'hang' };

/**
 * A scriptable AI-explanation adapter (P7-AI-01) — the
 * `FakeWeatherProviderAdapter` shape: `callCount` is the load-bearing
 * assertion surface for the kill-switch and budget tests ("zero Vertex
 * calls" is provable only by counting), and `requests` records every
 * packet so tests can assert exactly what would have been sent.
 */
export class FakeAiExplanationProviderAdapter implements AiExplanationProviderAdapter {
  callCount = 0;
  lastSignalAborted: boolean | null = null;
  readonly requests: AiExplanationRequest[] = [];

  readonly identity: AiExplanationModelIdentity;

  constructor(
    private behavior: FakeAiExplanationBehavior,
    identity: Partial<AiExplanationModelIdentity> = {},
  ) {
    this.identity = {
      model: identity.model ?? 'fake-explanation-model',
      promptTemplateVersion: identity.promptTemplateVersion ?? 1,
    };
  }

  setBehavior(behavior: FakeAiExplanationBehavior): void {
    this.behavior = behavior;
  }

  generateExplanation(
    request: AiExplanationRequest,
    signal: AbortSignal,
  ): Promise<AiExplanationAdapterOutcome> {
    this.callCount += 1;
    this.requests.push(request);
    const behavior = this.behavior;
    switch (behavior.kind) {
      case 'outcome':
        return Promise.resolve(behavior.outcome);
      case 'fail':
        return Promise.reject(
          behavior.error instanceof Error
            ? behavior.error
            : new Error('fake AI provider failure', { cause: behavior.error }),
        );
      case 'hang':
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            this.lastSignalAborted = true;
            reject(new Error('aborted by deadline'));
          });
        });
    }
  }
}

/**
 * A deterministic `TransactionalEmailAdapter` (P9C-INVITE-01) — this
 * capability's own real Resend adapter has no keyless mode (unlike Open-
 * Meteo's free tier), so every `CreateClientInvitation` test needs a fake
 * rather than a real network-touching path, the identical reasoning
 * `FakeMediaStorageGateway` documents for Cloud Storage.
 */
export type FakeTransactionalEmailBehavior =
  | { readonly kind: 'succeed' }
  | { readonly kind: 'fail'; readonly error?: unknown }
  | { readonly kind: 'hang' };

export class FakeTransactionalEmailAdapter implements TransactionalEmailAdapter {
  callCount = 0;
  readonly sentMessages: TransactionalEmailMessage[] = [];
  lastSignalAborted = false;

  constructor(private behavior: FakeTransactionalEmailBehavior = { kind: 'succeed' }) {}

  setBehavior(behavior: FakeTransactionalEmailBehavior): void {
    this.behavior = behavior;
  }

  send(
    message: TransactionalEmailMessage,
    signal: AbortSignal,
  ): Promise<TransactionalEmailSendResult> {
    this.callCount += 1;
    this.sentMessages.push(message);
    const behavior = this.behavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve({ providerMessageId: `fake-message-${String(this.callCount)}` });
      case 'fail':
        return Promise.reject(
          behavior.error instanceof Error
            ? behavior.error
            : new Error('fake transactional email provider failure', { cause: behavior.error }),
        );
      case 'hang':
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            this.lastSignalAborted = true;
            reject(new Error('aborted by deadline'));
          });
        });
    }
  }
}
