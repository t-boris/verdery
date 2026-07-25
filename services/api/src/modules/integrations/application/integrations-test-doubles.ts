/**
 * Shared deterministic test doubles for this module's unit and integration
 * tests — the same "one shared file, not N copies" reasoning
 * `media/application/media-test-doubles.ts` documents.
 *
 * The fake weather adapters here are the module's ONLY adapter
 * implementations: no real vendor exists (P0-PROV-01 undecided), and these
 * fakes are what proves the port/registry machinery is provider-agnostic —
 * the replacement tests run two of them through identical machinery.
 *
 * Not itself a `*.test.ts` file, so vitest never runs it as a suite.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { Georeference, GeoreferenceRepository } from '../../gardens-mapping/public.js';
import type { WeatherRecord, WeatherRecordKind } from '../domain/weather-record.js';
import type {
  ProviderQuotaConsumeResult,
  ProviderQuotaRepository,
  ProviderQuotaWindowKind,
} from './provider-quota-repository.js';
import { quotaWindowStart } from './provider-quota-repository.js';
import type { NormalizedWeatherReading, WeatherProviderAdapter } from './weather-provider.js';
import type {
  WeatherProviderMetadata,
  WeatherProviderQuotaLimits,
} from './weather-provider-registry.js';
import type { WeatherRecordRepository } from './weather-record-repository.js';

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
    limits: WeatherProviderQuotaLimits,
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

export class FakeGeoreferenceRepository implements GeoreferenceRepository {
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
