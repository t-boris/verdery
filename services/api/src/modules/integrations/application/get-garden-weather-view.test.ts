import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import {
  authorizationDenying,
  authorizationGranting,
} from '../../plants-inventory/application/plants-inventory-test-doubles.js';
import { createWeatherRecord } from '../domain/weather-record.js';
import type { WeatherRecord, WeatherRecordKind } from '../domain/weather-record.js';
import { GetGardenWeather } from './get-garden-weather.js';
import { GetGardenWeatherView } from './get-garden-weather-view.js';
import {
  FakeGeoreferenceRepository,
  InMemoryWeatherRecordRepository,
  SteppingClock,
  testGeoreference,
  testReading,
} from './integrations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0a';
const NOW = new Date('2026-07-25T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const POLICY = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };
const ATTRIBUTION = 'Weather data by Open-Meteo.com (https://open-meteo.com), CC BY 4.0';

const VIEWER = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'viewer' as const,
};

function storedRecord(
  id: string,
  kind: WeatherRecordKind,
  fetchedAt: Date,
  overrides: { readonly attributionText?: string | null } = {},
): WeatherRecord {
  const reading = testReading();
  return createWeatherRecord({
    id,
    gardenId: GARDEN_ID,
    rawProviderKey: 'open-meteo',
    kind,
    effectiveAt: new Date(fetchedAt.getTime() + (kind === 'forecast' ? HOUR_MS : -HOUR_MS / 12)),
    fetchedAt,
    location: { latitude: 52.1, longitude: 4.3 },
    measurements: reading.measurements,
    sourceUnits: reading.sourceUnits,
    quality: reading.quality,
    rawLicenseNote: 'CC BY 4.0',
    attributionText: overrides.attributionText ?? ATTRIBUTION,
    now: fetchedAt,
  });
}

function buildView(options: {
  readonly records?: readonly WeatherRecord[];
  readonly georeferenced?: boolean;
  readonly activeProviderKey?: string | null;
  readonly authorized?: boolean;
}): GetGardenWeatherView {
  const weatherRecords = new InMemoryWeatherRecordRepository();
  weatherRecords.records.push(...(options.records ?? []));
  const georeferences = new FakeGeoreferenceRepository();
  if (options.georeferenced ?? false) {
    georeferences.setCurrent(testGeoreference(GARDEN_ID, 4.3, 52.1));
  }
  return new GetGardenWeatherView(
    new GetGardenWeather(weatherRecords, POLICY, new SteppingClock(NOW)),
    (options.authorized ?? true) ? authorizationGranting(VIEWER) : authorizationDenying(),
    georeferences,
    options.activeProviderKey === undefined ? 'open-meteo' : options.activeProviderKey,
  );
}

describe('GetGardenWeatherView', () => {
  it('returns both readings with their freshness and the record attribution', async () => {
    const view = buildView({
      records: [
        storedRecord('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02', 'observation', NOW),
        storedRecord('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e03', 'forecast', NOW),
      ],
      georeferenced: true,
    });

    const result = await view.execute(GARDEN_ID, PROFILE_ID);

    expect(result.observation?.freshness).toBe('fresh');
    expect(result.forecast?.freshness).toBe('fresh');
    expect(result.attributionText).toBe(ATTRIBUTION);
    expect(result.unavailableReason).toBeNull();
    expect(result.providerConfigured).toBe(true);
  });

  it('labels an aged observation stale rather than hiding it — a stale reading is still the most recent one this garden has', async () => {
    const view = buildView({
      records: [
        storedRecord(
          '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02',
          'observation',
          new Date(NOW.getTime() - 3 * HOUR_MS),
        ),
      ],
      georeferenced: true,
    });

    const result = await view.execute(GARDEN_ID, PROFILE_ID);

    expect(result.observation?.freshness).toBe('stale');
    expect(result.unavailableReason).toBeNull();
  });

  it('reports noProviderConfigured before looking at the georeference — coordinates cannot help an environment that can fetch nothing', async () => {
    const view = buildView({ activeProviderKey: null, georeferenced: false });

    const result = await view.execute(GARDEN_ID, PROFILE_ID);

    expect(result.providerConfigured).toBe(false);
    expect(result.unavailableReason).toBe('noProviderConfigured');
  });

  it('reports gardenNotGeoreferenced — the one reason the person can resolve themselves', async () => {
    const view = buildView({ georeferenced: false });

    const result = await view.execute(GARDEN_ID, PROFILE_ID);

    expect(result.unavailableReason).toBe('gardenNotGeoreferenced');
  });

  it('reports notYetFetched when provider and coordinates are both in place', async () => {
    const view = buildView({ georeferenced: true });

    const result = await view.execute(GARDEN_ID, PROFILE_ID);

    expect(result.unavailableReason).toBe('notYetFetched');
    expect(result.observation).toBeNull();
    expect(result.forecast).toBeNull();
    expect(result.attributionText).toBeNull();
  });

  it('falls back to the forecast for attribution when only a forecast exists', async () => {
    const view = buildView({
      records: [storedRecord('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e03', 'forecast', NOW)],
      georeferenced: true,
    });

    const result = await view.execute(GARDEN_ID, PROFILE_ID);

    expect(result.observation).toBeNull();
    expect(result.attributionText).toBe(ATTRIBUTION);
  });

  it('requires viewGarden — a non-member cannot read the conditions over a garden', async () => {
    const view = buildView({ georeferenced: true, authorized: false });

    await expect(view.execute(GARDEN_ID, PROFILE_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never calls a provider, so a read cannot spend quota', async () => {
    const weatherRecords = new InMemoryWeatherRecordRepository();
    const view = new GetGardenWeatherView(
      new GetGardenWeather(weatherRecords, POLICY, new SteppingClock(NOW)),
      authorizationGranting(VIEWER),
      new FakeGeoreferenceRepository(),
      'open-meteo',
    );

    await view.execute(GARDEN_ID, PROFILE_ID);

    // The repository is the only collaborator a fetch could have written
    // through; a read path that refreshed would have inserted a row.
    expect(weatherRecords.records).toHaveLength(0);
  });
});
