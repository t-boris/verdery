/**
 * Unit tests for the Open-Meteo weather adapter — request shaping, payload
 * normalization, failure classification, and the licence/attribution that
 * reach a persisted record, all against RECORDED-SHAPE fixtures. No test
 * here touches the network: the adapter's `fetch` slice is injected, the
 * same way the Vertex adapter's client is.
 */

import { describe, expect, it } from 'vitest';
import {
  DependencyUnavailableError,
  InternalError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import {
  FakeGeoreferenceRepository,
  fixedClock,
  InMemoryProviderQuotaRepository,
  InMemoryWeatherRecordRepository,
  testGeoreference,
} from '../application/integrations-test-doubles.js';
import { RefreshGardenWeather } from '../application/refresh-garden-weather.js';
import { WeatherProviderRegistry } from '../application/weather-provider-registry.js';
import type { WeatherLocation } from '../domain/weather-record.js';
import { OPEN_METEO_PINNED_MODELS, parseOpenMeteoPayload } from './open-meteo-payload.js';
import type {
  OpenMeteoHttpFetch,
  OpenMeteoHttpResponse,
  OpenMeteoWeatherAdapterConfiguration,
} from './open-meteo-weather-adapter.js';
import { buildOpenMeteoRequestUrl, OpenMeteoWeatherAdapter } from './open-meteo-weather-adapter.js';
import {
  createOpenMeteoWeatherRegistration,
  openMeteoLicenseNote,
  OPEN_METEO_ATTRIBUTION_TEXT,
  OPEN_METEO_PROVIDER_KEY,
} from './open-meteo-weather-registration.js';

const NOW = new Date('2026-07-26T12:30:00Z');
const LOCATION: WeatherLocation = { latitude: 38.9072, longitude: -77.0369 };
const GARDEN_ID: Uuid = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d01';

const FREE: OpenMeteoWeatherAdapterConfiguration = {
  tier: 'free',
  apiKey: null,
  pastDays: 7,
  forecastDays: 7,
};

const CUSTOMER: OpenMeteoWeatherAdapterConfiguration = {
  ...FREE,
  tier: 'customer',
  apiKey: 'test-key-value',
};

/**
 * The verified response shape: `generationtime_ms`, `timezone`, `elevation`,
 * `daily_units` — and NO model-run/issue timestamp anywhere, which is why
 * freshness can only come from our own retrieval time.
 */
function recordedPayload(): unknown {
  return {
    latitude: 38.91,
    longitude: -77.04,
    generationtime_ms: 0.4189014,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    elevation: 12,
    current_units: {
      time: 'iso8601',
      interval: 'seconds',
      temperature_2m: '°C',
      relative_humidity_2m: '%',
      precipitation: 'mm',
      wind_speed_10m: 'm/s',
    },
    current: {
      time: '2026-07-26T12:15',
      interval: 900,
      temperature_2m: 29.4,
      relative_humidity_2m: 61,
      precipitation: 0.1,
      wind_speed_10m: 3.4,
    },
    daily_units: { time: 'iso8601', precipitation_sum: 'mm' },
    daily: {
      time: ['2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'],
      precipitation_sum: [4.2, 0, 1.1, 6.3],
    },
  };
}

type FetchBehavior =
  | { readonly kind: 'json'; readonly body: unknown }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'unreadableBody' }
  | { readonly kind: 'reject'; readonly error: unknown }
  /** Never settles until the caller's deadline aborts the signal. */
  | { readonly kind: 'hang' };

interface FetchRecorder {
  readonly httpFetch: OpenMeteoHttpFetch;
  readonly urls: string[];
  readonly signals: AbortSignal[];
  abortedCount: number;
}

function recordingFetch(behavior: FetchBehavior): FetchRecorder {
  const recorder: FetchRecorder = {
    urls: [],
    signals: [],
    abortedCount: 0,
    httpFetch: (url, init) => {
      recorder.urls.push(url);
      recorder.signals.push(init.signal);
      switch (behavior.kind) {
        case 'json':
          return Promise.resolve(jsonResponse(behavior.body));
        case 'status':
          return Promise.resolve({
            ok: false,
            status: behavior.status,
            json: () => Promise.resolve({}),
          });
        case 'unreadableBody':
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new Error('Unexpected token < in JSON')),
          });
        case 'reject':
          return Promise.reject(
            behavior.error instanceof Error ? behavior.error : new Error('transport failure'),
          );
        case 'hang':
          return new Promise<OpenMeteoHttpResponse>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              recorder.abortedCount += 1;
              reject(new Error('aborted'));
            });
          });
      }
    },
  };
  return recorder;
}

function jsonResponse(body: unknown): OpenMeteoHttpResponse {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function adapterOver(behavior: FetchBehavior, configuration = FREE) {
  const recorder = recordingFetch(behavior);
  const adapter = new OpenMeteoWeatherAdapter(recorder.httpFetch, configuration, fixedClock(NOW));
  return { adapter, recorder };
}

function parametersOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('buildOpenMeteoRequestUrl', () => {
  it('pins the NOAA models explicitly — the parameter that makes the stored licence deterministic', () => {
    const parameters = parametersOf(buildOpenMeteoRequestUrl(LOCATION, FREE));

    expect(parameters.get('models')).toBe('ncep_hrrr_conus,ncep_nbm_conus,gfs_seamless');
    expect(parameters.get('models')).toBe(OPEN_METEO_PINNED_MODELS.join(','));
    // No share-alike source may be reachable through this request.
    expect(parameters.get('models')).not.toContain('ukmo');
    expect(parameters.get('models')).not.toContain('metoffice');
  });

  it('requests SI units explicitly, UTC timestamps, and the configured day windows', () => {
    const parameters = parametersOf(
      buildOpenMeteoRequestUrl(LOCATION, { ...FREE, pastDays: 3, forecastDays: 10 }),
    );

    expect(parameters.get('temperature_unit')).toBe('celsius');
    expect(parameters.get('wind_speed_unit')).toBe('ms');
    expect(parameters.get('precipitation_unit')).toBe('mm');
    expect(parameters.get('timezone')).toBe('UTC');
    expect(parameters.get('past_days')).toBe('3');
    expect(parameters.get('forecast_days')).toBe('10');
    expect(parameters.get('current')).toBe(
      'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    );
    expect(parameters.get('daily')).toBe('precipitation_sum');
    // The forecast half. Without it a forecast could only ever report rain,
    // because the daily block carries nothing else.
    expect(parameters.get('hourly')).toBe(
      'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    );
    expect(parameters.get('latitude')).toBe('38.9072');
    expect(parameters.get('longitude')).toBe('-77.0369');
  });

  it('sends the free host with no key, and the paid host with one', () => {
    const free = new URL(buildOpenMeteoRequestUrl(LOCATION, FREE));
    expect(free.host).toBe('api.open-meteo.com');
    expect(free.pathname).toBe('/v1/forecast');
    expect(free.searchParams.get('apikey')).toBeNull();

    const customer = new URL(buildOpenMeteoRequestUrl(LOCATION, CUSTOMER));
    expect(customer.host).toBe('customer-api.open-meteo.com');
    expect(customer.searchParams.get('apikey')).toBe('test-key-value');
  });
});

describe('OpenMeteoWeatherAdapter configuration', () => {
  it('runs keyless on the free tier — the state of every environment today', async () => {
    const { adapter, recorder } = adapterOver({ kind: 'json', body: recordedPayload() });

    await adapter.fetchWeather(LOCATION, new AbortController().signal);

    expect(recorder.urls[0]).toContain('https://api.open-meteo.com/v1/forecast');
    expect(recorder.urls[0]).not.toContain('apikey');
    // The keyless host is non-commercial-only, and the licence snapshot says so.
    expect(openMeteoLicenseNote('free')).toContain('non-commercial use only');
    expect(openMeteoLicenseNote('customer')).toContain('commercial use');
    expect(openMeteoLicenseNote('customer')).toContain('CC BY 4.0');
  });

  it('refuses the paid host without a key instead of failing every request at runtime', () => {
    const { httpFetch } = recordingFetch({ kind: 'json', body: recordedPayload() });

    expect(
      () =>
        new OpenMeteoWeatherAdapter(
          httpFetch,
          { ...FREE, tier: 'customer', apiKey: null },
          fixedClock(NOW),
        ),
    ).toThrow(InternalError);
  });
});

describe('OpenMeteoWeatherAdapter.fetchWeather normalization', () => {
  it('normalizes a real-shaped payload into current-plus-daily readings', async () => {
    const { adapter } = adapterOver({ kind: 'json', body: recordedPayload() });

    const readings = await adapter.fetchWeather(LOCATION, new AbortController().signal);

    expect(readings).toHaveLength(5);

    const [current] = readings;
    expect(current).toEqual({
      kind: 'observation',
      effectiveAt: new Date('2026-07-26T12:15:00Z'),
      measurements: {
        temperatureCelsius: 29.4,
        precipitationMm: 0.1,
        windSpeedMps: 3.4,
        humidityPercent: 61,
      },
      // Provenance is what CAME BACK, for exactly the measurements present.
      sourceUnits: {
        temperature: '°C',
        precipitation: 'mm',
        windSpeed: 'm/s',
        humidity: '%',
      },
      // No confidence exists on any Open-Meteo tier; it is never synthesized.
      quality: { confidence: null, label: 'model_analysis' },
      // The `current` block's precipitation is documented as the preceding
      // hour. Recording that interval is what lets a weekly rainfall total
      // sum daily rows without also counting this hour inside one of them.
      precipitationIntervalSeconds: 3600,
    });
  });

  it('labels past model output honestly and calls an unfinished day a forecast', async () => {
    const { adapter } = adapterOver({ kind: 'json', body: recordedPayload() });

    const daily = (await adapter.fetchWeather(LOCATION, new AbortController().signal)).slice(1);

    expect(
      daily.map((reading) => [reading.effectiveAt.toISOString(), reading.kind, reading.quality]),
    ).toEqual([
      // Elapsed days: model ANALYSIS, not a gauge measurement.
      ['2026-07-24T00:00:00.000Z', 'observation', { confidence: null, label: 'model_analysis' }],
      ['2026-07-25T00:00:00.000Z', 'observation', { confidence: null, label: 'model_analysis' }],
      // Today is only partly elapsed, so its sum is still forecast.
      ['2026-07-26T00:00:00.000Z', 'forecast', { confidence: null, label: 'model_forecast' }],
      ['2026-07-27T00:00:00.000Z', 'forecast', { confidence: null, label: 'model_forecast' }],
    ]);
    expect(daily[0]?.measurements).toEqual({
      temperatureCelsius: null,
      precipitationMm: 4.2,
      windSpeedMps: null,
      humidityPercent: null,
    });
    expect(daily[0]?.sourceUnits).toEqual({
      temperature: null,
      precipitation: 'mm',
      windSpeed: null,
      humidity: null,
    });
  });

  it('resolves model-suffixed variables in the pinned order, falling back past the HRRR horizon', async () => {
    const body = {
      current_units: { temperature_2m_ncep_hrrr_conus: '°C' },
      current: { time: '2026-07-26T12:00', temperature_2m_ncep_hrrr_conus: 27.5 },
      daily_units: {
        precipitation_sum_ncep_hrrr_conus: 'mm',
        precipitation_sum_gfs_seamless: 'mm',
      },
      daily: {
        time: ['2026-07-27', '2026-07-28'],
        // HRRR does not reach the second day; GFS does.
        precipitation_sum_ncep_hrrr_conus: [2.5, null],
        precipitation_sum_gfs_seamless: [9.9, 3.3],
      },
    };
    const { adapter } = adapterOver({ kind: 'json', body });

    const readings = await adapter.fetchWeather(LOCATION, new AbortController().signal);

    expect(readings[0]?.measurements.temperatureCelsius).toBe(27.5);
    // Highest-priority model wins where it has data; the fallback fills the rest.
    expect(readings[1]?.measurements.precipitationMm).toBe(2.5);
    expect(readings[2]?.measurements.precipitationMm).toBe(3.3);
  });

  it('drops a value whose returned unit is not the SI unit that was requested', async () => {
    const body = {
      current_units: {
        temperature_2m: '°F',
        relative_humidity_2m: '%',
        precipitation: 'inch',
        wind_speed_10m: 'm/s',
      },
      current: {
        time: '2026-07-26T12:00',
        temperature_2m: 85.2,
        relative_humidity_2m: 61,
        precipitation: 0.02,
        wind_speed_10m: 3.4,
      },
    };
    const { adapter } = adapterOver({ kind: 'json', body });

    const [reading] = await adapter.fetchWeather(LOCATION, new AbortController().signal);

    // Never converted behind the caller's back, never recorded as SI.
    expect(reading?.measurements.temperatureCelsius).toBeNull();
    expect(reading?.measurements.precipitationMm).toBeNull();
    expect(reading?.sourceUnits.temperature).toBeNull();
    expect(reading?.measurements.windSpeedMps).toBe(3.4);
    expect(reading?.measurements.humidityPercent).toBe(61);
  });

  it('degrades partial rows one by one instead of losing the response', async () => {
    const body = {
      daily_units: { precipitation_sum: 'mm' },
      daily: {
        time: ['2026-07-24', 'not-a-date', '2026-07-25', '2026-07-27'],
        precipitation_sum: [4.2, 1.1, null, 6.3],
      },
    };
    const { adapter } = adapterOver({ kind: 'json', body });

    const readings = await adapter.fetchWeather(LOCATION, new AbortController().signal);

    // Unparsable timestamp and a null value drop their own rows only.
    expect(readings.map((reading) => reading.effectiveAt.toISOString())).toEqual([
      '2026-07-24T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z',
    ]);
  });

  it('returns nothing rather than something invented when a response carries no usable data', async () => {
    const { adapter } = adapterOver({
      kind: 'json',
      body: {
        daily_units: { precipitation_sum: 'mm' },
        daily: { time: [], precipitation_sum: [] },
      },
    });

    await expect(adapter.fetchWeather(LOCATION, new AbortController().signal)).resolves.toEqual([]);
  });
});

describe('OpenMeteoWeatherAdapter failure handling', () => {
  const signal = new AbortController().signal;

  it('takes the nearest hour that has not begun as a full point forecast', () => {
    const body = {
      hourly_units: {
        time: 'iso8601',
        temperature_2m: '\u00b0C',
        relative_humidity_2m: '%',
        precipitation: 'mm',
        wind_speed_10m: 'm/s',
      },
      hourly: {
        // Two hours already elapsed, then the next three.
        time: [
          '2026-07-26T10:00',
          '2026-07-26T11:00',
          '2026-07-26T13:00',
          '2026-07-26T14:00',
          '2026-07-26T15:00',
        ],
        temperature_2m: [20.1, 21.2, 24.4, 25.9, 26.3],
        relative_humidity_2m: [70, 66, 58, 55, 54],
        precipitation: [0, 0.2, 1.5, 0, 0],
        wind_speed_10m: [1.1, 1.4, 2.6, 2.9, 3.1],
      },
    };

    const readings = parseOpenMeteoPayload(body, new Date('2026-07-26T12:15:00Z'));

    // Exactly one forecast, and it is 13:00 — not 11:00 (already gone) and not
    // 15:00 (the furthest, which is what the deployed panel used to show).
    expect(readings).toHaveLength(1);
    expect(readings[0]?.kind).toBe('forecast');
    expect(readings[0]?.effectiveAt.toISOString()).toBe('2026-07-26T13:00:00.000Z');
    expect(readings[0]?.measurements).toEqual({
      temperatureCelsius: 24.4,
      precipitationMm: 1.5,
      windSpeedMps: 2.6,
      humidityPercent: 58,
    });
    // An hourly precipitation figure accumulates over its own hour, never the
    // day that contains it.
    expect(readings[0]?.precipitationIntervalSeconds).toBe(3600);
  });

  it('rejects a malformed payload rather than repairing it', async () => {
    const { adapter } = adapterOver({ kind: 'json', body: { current: 'sunny-ish' } });

    await expect(adapter.fetchWeather(LOCATION, signal)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('rejects a non-2xx status without echoing the URL that carries the API key', async () => {
    const { adapter } = adapterOver({ kind: 'status', status: 429 }, CUSTOMER);

    await expect(adapter.fetchWeather(LOCATION, signal)).rejects.toMatchObject({
      code: 'integrations.open_meteo.http_status',
    });
    await adapter.fetchWeather(LOCATION, signal).catch((error: unknown) => {
      expect((error as Error).message).not.toContain('test-key-value');
    });
  });

  it('rejects an unreadable body and a transport failure', async () => {
    const unreadable = adapterOver({ kind: 'unreadableBody' });
    await expect(unreadable.adapter.fetchWeather(LOCATION, signal)).rejects.toMatchObject({
      code: 'integrations.open_meteo.unreadable_body',
    });

    const broken = adapterOver({ kind: 'reject', error: new Error('ECONNRESET') });
    await expect(broken.adapter.fetchWeather(LOCATION, signal)).rejects.toMatchObject({
      code: 'integrations.open_meteo.request_failed',
    });
  });

  it("passes the caller's abort signal straight into the request", async () => {
    const controller = new AbortController();
    const { adapter, recorder } = adapterOver({ kind: 'hang' });

    const pending = adapter.fetchWeather(LOCATION, controller.signal);
    expect(recorder.signals[0]).toBe(controller.signal);

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(recorder.abortedCount).toBe(1);
  });
});

// --- Through the caller: what actually reaches a persisted record ------------

interface HarnessOptions {
  readonly behavior: FetchBehavior;
  readonly configuration?: OpenMeteoWeatherAdapterConfiguration;
  readonly fetchTimeoutMs?: number;
}

function refreshHarness(options: HarnessOptions) {
  const recorder = recordingFetch(options.behavior);
  const registration = createOpenMeteoWeatherRegistration(
    {
      configuration: options.configuration ?? FREE,
      fetchTimeoutMs: options.fetchTimeoutMs ?? 1_000,
      quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    },
    recorder.httpFetch,
    fixedClock(NOW),
  );
  const weatherRecords = new InMemoryWeatherRecordRepository();
  const georeferences = new FakeGeoreferenceRepository();
  georeferences.setCurrent(testGeoreference(GARDEN_ID, LOCATION.longitude, LOCATION.latitude));

  const refresh = new RefreshGardenWeather(
    new WeatherProviderRegistry([registration]),
    {
      activeProviderKey: OPEN_METEO_PROVIDER_KEY,
      freshnessPolicy: { observationFreshForMs: 3_600_000, forecastFreshForMs: 21_600_000 },
    },
    weatherRecords,
    new InMemoryProviderQuotaRepository(),
    georeferences,
    fixedClock(NOW),
  );
  return { refresh, weatherRecords, recorder, registration };
}

describe('the Open-Meteo registration through RefreshGardenWeather', () => {
  it('stamps the CC BY 4.0 licence and the attribution link on every stored record', async () => {
    const { refresh, weatherRecords } = refreshHarness({
      behavior: { kind: 'json', body: recordedPayload() },
    });

    const result = await refresh.execute({ gardenId: GARDEN_ID });

    expect(result.outcome).toBe('refreshed');
    expect(weatherRecords.records).toHaveLength(5);
    for (const record of weatherRecords.records) {
      expect(record.providerKey).toBe('open-meteo');
      expect(record.licenseNote).toContain('CC BY 4.0');
      expect(record.licenseNote).toContain('ncep_hrrr_conus');
      expect(record.licenseNote).toContain('non-commercial use only');
      // The terms require a LINK next to displayed data; the domain has one
      // free-text attribution field, so the URL travels inside it.
      expect(record.attributionText).toBe(OPEN_METEO_ATTRIBUTION_TEXT);
      expect(record.attributionText).toContain('https://open-meteo.com');
      // Freshness comes only from our retrieval time: the provider declares none.
      expect(record.fetchedAt).toEqual(NOW);
      expect(record.quality.confidence).toBeNull();
    }
  });

  it('degrades a malformed payload to a typed outcome instead of crashing the sweep', async () => {
    const { refresh, weatherRecords } = refreshHarness({
      behavior: { kind: 'json', body: { daily: 'not-a-container' } },
    });

    await expect(refresh.execute({ gardenId: GARDEN_ID })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'providerFailed',
    });
    expect(weatherRecords.records).toHaveLength(0);
  });

  it("aborts the request when the caller's strict deadline expires", async () => {
    const { refresh, recorder } = refreshHarness({ behavior: { kind: 'hang' }, fetchTimeoutMs: 5 });

    await expect(refresh.execute({ gardenId: GARDEN_ID })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'providerTimeout',
    });
    expect(recorder.abortedCount).toBe(1);
  });
});
