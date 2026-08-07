import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createWeatherRecord } from '../domain/weather-record.js';
import type { WeatherRecord } from '../domain/weather-record.js';
import { GetGardenWeather } from './get-garden-weather.js';
import {
  InMemoryWeatherRecordRepository,
  SteppingClock,
  testReading,
} from './integrations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01';
const FETCHED_AT = new Date('2026-07-25T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const POLICY = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

function storedRecord(overrides: Partial<WeatherRecord> = {}): WeatherRecord {
  const reading = testReading();
  return {
    ...createWeatherRecord({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02',
      gardenId: GARDEN_ID,
      rawProviderKey: 'fake-provider-a',
      kind: reading.kind,
      effectiveAt: new Date(FETCHED_AT.getTime() - 5 * 60 * 1000),
      fetchedAt: FETCHED_AT,
      location: { latitude: 52.1, longitude: 4.3 },
      measurements: reading.measurements,
      precipitationIntervalSeconds: null,
      sourceUnits: reading.sourceUnits,
      quality: reading.quality,
      rawLicenseNote: 'test license',
      attributionText: null,
      now: FETCHED_AT,
    }),
    ...overrides,
  };
}

describe('GetGardenWeather', () => {
  it('returns a typed noRecord outcome when nothing is stored — the no-provider default of every garden today', async () => {
    const query = new GetGardenWeather(
      new InMemoryWeatherRecordRepository(),
      POLICY,
      new SteppingClock(FETCHED_AT),
    );
    await expect(query.execute({ gardenId: GARDEN_ID })).resolves.toEqual({ outcome: 'noRecord' });
  });

  it('returns the latest observation with an explicit freshness classification that flips at the window boundary', async () => {
    const repository = new InMemoryWeatherRecordRepository();
    await repository.insertMany([storedRecord()]);
    const clock = new SteppingClock(FETCHED_AT);
    const query = new GetGardenWeather(repository, POLICY, clock);

    clock.advanceMs(POLICY.observationFreshForMs);
    const fresh = await query.execute({ gardenId: GARDEN_ID });
    expect(fresh.outcome).toBe('available');
    if (fresh.outcome === 'available') {
      expect(fresh.freshness).toBe('fresh');
      expect(fresh.record.providerKey).toBe('fake-provider-a');
    }

    clock.advanceMs(1);
    const stale = await query.execute({ gardenId: GARDEN_ID });
    expect(stale.outcome).toBe('available');
    if (stale.outcome === 'available') {
      expect(stale.freshness).toBe('stale');
    }
  });

  it('serves the most recently fetched record of the requested kind', async () => {
    const repository = new InMemoryWeatherRecordRepository();
    const older = storedRecord({
      id: 'older',
      fetchedAt: new Date(FETCHED_AT.getTime() - HOUR_MS),
    });
    const forecast = storedRecord({
      id: 'forecast',
      kind: 'forecast',
      effectiveAt: new Date(FETCHED_AT.getTime() + 24 * HOUR_MS),
    });
    await repository.insertMany([older, storedRecord(), forecast]);
    const query = new GetGardenWeather(repository, POLICY, new SteppingClock(FETCHED_AT));

    const observation = await query.execute({ gardenId: GARDEN_ID });
    if (observation.outcome === 'available') {
      expect(observation.record.id).not.toBe('older');
      expect(observation.record.kind).toBe('observation');
    }

    const forecastResult = await query.execute({ gardenId: GARDEN_ID, kind: 'forecast' });
    expect(forecastResult.outcome).toBe('available');
    if (forecastResult.outcome === 'available') {
      expect(forecastResult.record.id).toBe('forecast');
    }
  });

  it('rejects an invalid freshness policy at construction', () => {
    expect(
      () =>
        new GetGardenWeather(
          new InMemoryWeatherRecordRepository(),
          { observationFreshForMs: 0, forecastFreshForMs: HOUR_MS },
          new SteppingClock(FETCHED_AT),
        ),
    ).toThrow(ValidationError);
  });
});
