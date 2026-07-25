/**
 * Provider contract, cache, quota, timeout, and honest-degradation tests
 * for `RefreshGardenWeather` — P7-INT-01's own acceptance evidence
 * ("Provider contract and stale-data tests") at the unit level, over
 * deterministic fakes. The same scenarios run against real PostgreSQL in
 * `tests/integration/integrations-weather.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import {
  FakeGeoreferenceRepository,
  FakeWeatherProviderAdapter,
  InMemoryProviderQuotaRepository,
  InMemoryWeatherRecordRepository,
  SteppingClock,
  testGeoreference,
  testProviderMetadata,
  testReading,
} from './integrations-test-doubles.js';
import type { RefreshGardenWeatherConfiguration } from './refresh-garden-weather.js';
import { RefreshGardenWeather } from './refresh-garden-weather.js';
import type { WeatherProviderRegistration } from './weather-provider-registry.js';
import { WeatherProviderRegistry } from './weather-provider-registry.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d01';
const START = new Date('2026-07-25T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

interface HarnessOptions {
  readonly registrations?: readonly WeatherProviderRegistration[];
  readonly activeProviderKey?: string | null;
  readonly georeferenced?: boolean;
  readonly freshnessPolicy?: typeof FRESHNESS;
}

function makeHarness(options: HarnessOptions = {}) {
  const clock = new SteppingClock(START);
  const weatherRecords = new InMemoryWeatherRecordRepository();
  const providerQuotas = new InMemoryProviderQuotaRepository();
  const georeferences = new FakeGeoreferenceRepository();
  if (options.georeferenced !== false) {
    georeferences.setCurrent(testGeoreference(GARDEN_ID, 4.3, 52.1));
  }
  const registry = new WeatherProviderRegistry(options.registrations ?? []);
  const configuration: RefreshGardenWeatherConfiguration = {
    activeProviderKey: options.activeProviderKey ?? null,
    freshnessPolicy: options.freshnessPolicy ?? FRESHNESS,
  };
  const refresh = new RefreshGardenWeather(
    registry,
    configuration,
    weatherRecords,
    providerQuotas,
    georeferences,
    clock,
  );
  return { clock, weatherRecords, providerQuotas, georeferences, registry, refresh };
}

function successfulRegistration(providerKey: string): {
  registration: WeatherProviderRegistration;
  adapter: FakeWeatherProviderAdapter;
} {
  const adapter = new FakeWeatherProviderAdapter({
    kind: 'succeed',
    readings: [
      testReading({ effectiveAt: new Date(START.getTime() - 5 * 60 * 1000) }),
      testReading({ kind: 'forecast', effectiveAt: new Date(START.getTime() + 24 * HOUR_MS) }),
    ],
  });
  return { registration: { metadata: testProviderMetadata(providerKey), adapter }, adapter };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RefreshGardenWeather — the honest no-provider state', () => {
  it('returns a typed noProviderConfigured outcome with nothing stored — never an empty success', async () => {
    const { refresh, weatherRecords } = makeHarness();

    const result = await refresh.execute({ gardenId: GARDEN_ID });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });
    expect(weatherRecords.records).toHaveLength(0);
  });

  it('serves a stored record explicitly labeled stale when no provider is configured anymore', async () => {
    const withProvider = successfulRegistration('fake-provider-a');
    const harness = makeHarness({
      registrations: [withProvider.registration],
      activeProviderKey: 'fake-provider-a',
    });
    await harness.refresh.execute({ gardenId: GARDEN_ID });

    // Same stores, provider now unconfigured, freshness window long expired.
    harness.clock.advanceMs(3 * HOUR_MS);
    const revisit = new RefreshGardenWeather(
      new WeatherProviderRegistry([]),
      { activeProviderKey: null, freshnessPolicy: FRESHNESS },
      harness.weatherRecords,
      harness.providerQuotas,
      harness.georeferences,
      harness.clock,
    );

    const result = await revisit.execute({ gardenId: GARDEN_ID });
    expect(result.outcome).toBe('staleServed');
    if (result.outcome === 'staleServed') {
      expect(result.reason).toBe('noProviderConfigured');
      expect(result.record.providerKey).toBe('fake-provider-a');
    }
  });

  it('rejects a configured active key with no registration loudly, at construction', () => {
    expect(() => makeHarness({ activeProviderKey: 'ghost-provider' })).toThrow(InternalError);
  });
});

describe('RefreshGardenWeather — location honesty', () => {
  it('returns a typed gardenNotGeoreferenced outcome instead of guessing a location', async () => {
    const { registration } = successfulRegistration('fake-provider-a');
    const { refresh } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-provider-a',
      georeferenced: false,
    });

    const result = await refresh.execute({ gardenId: GARDEN_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'gardenNotGeoreferenced' });
  });
});

describe('RefreshGardenWeather — fetch, normalization, and provenance', () => {
  it('persists normalized records stamped with the registry entry’s provider key, license, and the anchor coordinates', async () => {
    const { registration, adapter } = successfulRegistration('fake-provider-a');
    const { refresh, weatherRecords, providerQuotas, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-provider-a',
    });

    const result = await refresh.execute({ gardenId: GARDEN_ID });

    expect(result.outcome).toBe('refreshed');
    expect(adapter.callCount).toBe(1);
    expect(weatherRecords.records).toHaveLength(2);
    const [observation, forecast] = weatherRecords.records;
    expect(observation?.kind).toBe('observation');
    expect(forecast?.kind).toBe('forecast');
    for (const record of weatherRecords.records) {
      expect(record.providerKey).toBe('fake-provider-a');
      expect(record.licenseNote).toBe(registration.metadata.licenseNote);
      expect(record.attributionText).toBe(registration.metadata.attributionText);
      // testGeoreference stores the GeoJSON [longitude, latitude] pair.
      expect(record.location).toEqual({ latitude: 52.1, longitude: 4.3 });
      expect(record.fetchedAt).toEqual(clock.now());
    }
    expect(providerQuotas.countFor('fake-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('degrades to a typed providerReturnedNoData outcome on an empty reading list', async () => {
    const adapter = new FakeWeatherProviderAdapter({ kind: 'succeed', readings: [] });
    const { refresh } = makeHarness({
      registrations: [{ metadata: testProviderMetadata('fake-provider-a'), adapter }],
      activeProviderKey: 'fake-provider-a',
    });

    const result = await refresh.execute({ gardenId: GARDEN_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedNoData' });
  });

  it('rejects malformed provider data as a typed outcome and persists nothing', async () => {
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [
        testReading({
          measurements: { ...testReading().measurements, humidityPercent: 150 },
        }),
      ],
    });
    const { refresh, weatherRecords } = makeHarness({
      registrations: [{ metadata: testProviderMetadata('fake-provider-a'), adapter }],
      activeProviderKey: 'fake-provider-a',
    });

    const result = await refresh.execute({ gardenId: GARDEN_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerReturnedInvalidData' });
    expect(weatherRecords.records).toHaveLength(0);
  });
});

describe('RefreshGardenWeather — cache and staleness', () => {
  it('serves the stored record within the freshness window and never refetches', async () => {
    const { registration, adapter } = successfulRegistration('fake-provider-a');
    const { refresh, clock, providerQuotas } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-provider-a',
    });

    await refresh.execute({ gardenId: GARDEN_ID });
    clock.advanceMs(FRESHNESS.observationFreshForMs); // boundary: still fresh
    const second = await refresh.execute({ gardenId: GARDEN_ID });

    expect(second.outcome).toBe('freshCacheHit');
    expect(adapter.callCount).toBe(1);
    // The cache hit consumed nothing: the day window still counts one call.
    expect(providerQuotas.countFor('fake-provider-a', 'day', clock.now())).toBe(1);
  });

  it('refetches once the freshness window has passed', async () => {
    const { registration, adapter } = successfulRegistration('fake-provider-a');
    const { refresh, clock } = makeHarness({
      registrations: [registration],
      activeProviderKey: 'fake-provider-a',
    });

    await refresh.execute({ gardenId: GARDEN_ID });
    clock.advanceMs(FRESHNESS.observationFreshForMs + 1);
    const second = await refresh.execute({ gardenId: GARDEN_ID });

    expect(second.outcome).toBe('refreshed');
    expect(adapter.callCount).toBe(2);
  });
});

describe('RefreshGardenWeather — quota', () => {
  it('refuses a call over budget as a typed quotaExhausted degradation, serving the stale record', async () => {
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 60_000) })],
    });
    const metadata = testProviderMetadata('fake-provider-a', {
      quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null },
    });
    // A freshness window narrower than the quota window, so the second call
    // is past freshness while still inside the same spent UTC hour.
    const narrowFreshness = { observationFreshForMs: 10 * 60 * 1000, forecastFreshForMs: HOUR_MS };
    const { refresh, clock } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-provider-a',
      freshnessPolicy: narrowFreshness,
    });

    await refresh.execute({ gardenId: GARDEN_ID });
    clock.advanceMs(narrowFreshness.observationFreshForMs + 1);
    const result = await refresh.execute({ gardenId: GARDEN_ID });

    expect(adapter.callCount).toBe(1);
    expect(result.outcome).toBe('staleServed');
    if (result.outcome === 'staleServed') {
      expect(result.reason).toBe('quotaExhausted');
      expect(result.record.providerKey).toBe('fake-provider-a');
    }
  });

  it('reports the day window when the daily budget is the one exhausted', async () => {
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 60_000) })],
    });
    const metadata = testProviderMetadata('fake-provider-a', {
      quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: 1 },
    });
    const { refresh, clock, providerQuotas } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-provider-a',
    });

    await refresh.execute({ gardenId: GARDEN_ID });
    clock.advanceMs(2 * HOUR_MS); // new hour window, same UTC day
    const result = await refresh.execute({ gardenId: GARDEN_ID });

    expect(result.outcome).toBe('staleServed');
    expect(adapter.callCount).toBe(1);
    expect(providerQuotas.countFor('fake-provider-a', 'day', clock.now())).toBe(1);
  });
});

describe('RefreshGardenWeather — timeout and failure', () => {
  it('degrades to a typed providerTimeout outcome when the adapter outlives its strict deadline, keeping the quota consumed', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWeatherProviderAdapter({ kind: 'hang' });
    const metadata = testProviderMetadata('fake-provider-a', { fetchTimeoutMs: 500 });
    const { refresh, providerQuotas, clock } = makeHarness({
      registrations: [{ metadata, adapter }],
      activeProviderKey: 'fake-provider-a',
    });

    const promise = refresh.execute({ gardenId: GARDEN_ID });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerTimeout' });
    expect(adapter.lastSignalAborted).toBe(true);
    // The call was made: its quota consumption stands.
    expect(providerQuotas.countFor('fake-provider-a', 'hour', clock.now())).toBe(1);
  });

  it('degrades to a typed providerFailed outcome on adapter rejection', async () => {
    const adapter = new FakeWeatherProviderAdapter({ kind: 'fail' });
    const { refresh } = makeHarness({
      registrations: [{ metadata: testProviderMetadata('fake-provider-a'), adapter }],
      activeProviderKey: 'fake-provider-a',
    });

    const result = await refresh.execute({ gardenId: GARDEN_ID });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerFailed' });
  });
});

describe('RefreshGardenWeather — provider replacement', () => {
  it('replaces a provider with one registration plus a configuration key change, without touching prior records', async () => {
    const a = successfulRegistration('fake-provider-a');
    const b = successfulRegistration('fake-provider-b');
    const harness = makeHarness({
      registrations: [a.registration, b.registration],
      activeProviderKey: 'fake-provider-a',
    });

    await harness.refresh.execute({ gardenId: GARDEN_ID });
    harness.clock.advanceMs(FRESHNESS.observationFreshForMs + 1);

    // The "replacement": same registry, same stores, same machinery — only
    // the configured active key changes.
    const replaced = new RefreshGardenWeather(
      harness.registry,
      { activeProviderKey: 'fake-provider-b', freshnessPolicy: FRESHNESS },
      harness.weatherRecords,
      harness.providerQuotas,
      harness.georeferences,
      harness.clock,
    );
    const result = await replaced.execute({ gardenId: GARDEN_ID });

    expect(result.outcome).toBe('refreshed');
    expect(a.adapter.callCount).toBe(1);
    expect(b.adapter.callCount).toBe(1);

    const byProvider = new Map<string, number>();
    for (const record of harness.weatherRecords.records) {
      byProvider.set(record.providerKey, (byProvider.get(record.providerKey) ?? 0) + 1);
    }
    expect(byProvider.get('fake-provider-a')).toBe(2);
    expect(byProvider.get('fake-provider-b')).toBe(2);
    // Prior records keep their original provider key and license snapshot —
    // "Provider selection ... does not change domain records silently."
    const priorRecord = harness.weatherRecords.records[0];
    expect(priorRecord?.licenseNote).toBe(a.registration.metadata.licenseNote);
  });
});
