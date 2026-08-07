/**
 * Open-Meteo response payload → `NormalizedWeatherReading[]`.
 *
 * Everything vendor-shaped about Open-Meteo lives here and in
 * `open-meteo-weather-adapter.ts` ("Provider SDK and payload types remain
 * inside the adapter", external-integrations.md section 2). Nothing below
 * stamps garden, fetch time, provider key, license, or attribution — those
 * are the CALLER's facts (`weather-provider.ts`), stamped by
 * `refresh-garden-weather.ts` from the registry entry.
 *
 * WHAT THE PROVIDER DOES AND DOES NOT SUPPLY (verified live, 2026-07-26):
 *
 * - No model-run / issue timestamp exists anywhere in the response
 *   (`generationtime_ms` is server compute time, not a data issue time) and
 *   no cache headers accompany it. Freshness therefore derives ONLY from our
 *   own retrieval time, which is exactly what `WeatherRecord.fetchedAt`
 *   already is. No effective time is invented here: every `effectiveAt`
 *   below is a timestamp the provider itself sent.
 * - No confidence value exists on any tier, so `quality.confidence` is
 *   always `null` — never synthesized.
 * - `past_days` returns PAST MODEL OUTPUT, not gauge measurements. Recent
 *   precipitation is available and is what the watering rules need, but it
 *   is model-analysed rainfall. `quality.label` says so:
 *   `model_analysis` for an elapsed period, `model_forecast` for one that
 *   has not finished. The domain's two `kind` values (`observation` /
 *   `forecast`) cannot express "past model analysis" on their own — an
 *   elapsed period is recorded as `observation` because its effective time
 *   is in the past, and the honest qualifier rides in `quality.label`.
 *
 * UNIT PROVENANCE: the request asks for SI explicitly (`temperature_unit=
 * celsius`, `wind_speed_unit=ms`, `precipitation_unit=mm`); the response
 * echoes its own unit label per variable. A measurement is accepted ONLY
 * when the echoed label is the SI label that was requested, and the echoed
 * label — what actually came back — is what lands in `sourceUnits`. A
 * mismatched or missing label drops that one measurement rather than
 * claiming a conversion nobody performed.
 *
 * MODEL PINNING: Open-Meteo aggregates sources under mixed licenses (UK Met
 * Office data is CC-BY-SA, share-alike, which must never enter our records),
 * so the request pins `models=` explicitly. When more than one model is
 * requested the API may return variables suffixed with the model name, so
 * every variable is resolved as "plain key, else `<variable>_<model>` in the
 * pinned priority order" and the first finite value wins — which is also
 * exactly the intended fallback for horizons HRRR does not cover.
 *
 * Source: architecture/external-integrations.md, sections "2. Integration
 * Boundary", "3. Adapter Contract", "5. Weather".
 */

import { z } from 'zod';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { NormalizedWeatherReading } from '../application/weather-provider.js';
import type {
  WeatherMeasurements,
  WeatherProviderQuality,
  WeatherRecordKind,
  WeatherSourceUnits,
} from '../domain/weather-record.js';

/**
 * The pinned NOAA models, in priority order: HRRR CONUS first (highest
 * resolution), NBM CONUS and GFS seamless for the horizons HRRR does not
 * cover. Deliberately NOT configuration: which models answer decides which
 * license is stamped on every stored row, so it is a reviewed code fact, not
 * a runtime knob an environment variable could quietly widen to a
 * share-alike source.
 */
export const OPEN_METEO_PINNED_MODELS = [
  'ncep_hrrr_conus',
  'ncep_nbm_conus',
  'gfs_seamless',
] as const;

/** Current-conditions variables requested, in the order the request sends them. */
export const OPEN_METEO_CURRENT_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'wind_speed_10m',
] as const;

/**
 * Daily variables requested. Only precipitation is taken: the domain record
 * holds ONE temperature and ONE wind speed, so a daily maximum or minimum
 * would have to be recorded as if it were the day's temperature — a
 * misstatement. Daily precipitation is a genuine sum and is what the
 * watering rules read.
 */
export const OPEN_METEO_DAILY_VARIABLES = ['precipitation_sum'] as const;

/**
 * The SI unit labels the API echoes for the units the request asks for.
 * A measurement whose echoed label differs is dropped, never converted.
 */
const EXPECTED_UNIT_LABELS = {
  temperature: '°C',
  precipitation: 'mm',
  windSpeed: 'm/s',
  humidity: '%',
} as const;

/** Quality labels: honest provenance for model output that is not a gauge measurement. */
export const OPEN_METEO_ANALYSIS_QUALITY_LABEL = 'model_analysis';
export const OPEN_METEO_FORECAST_QUALITY_LABEL = 'model_forecast';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What each block's precipitation figure accumulates over, per Open-Meteo's
 * own documentation: `current.precipitation` is the preceding hour, and
 * `daily.precipitation_sum` is the whole day.
 *
 * Recorded per row so accumulated rainfall can be summed over one interval
 * class. Adding the two together would count the current hour twice — once
 * on its own and once inside the day that contains it.
 */
export const OPEN_METEO_CURRENT_PRECIPITATION_INTERVAL_SECONDS = 60 * 60;
export const OPEN_METEO_DAILY_PRECIPITATION_INTERVAL_SECONDS = 24 * 60 * 60;

/** Open-Meteo never supplies a confidence value on any tier — the field stays null. */
function qualityFor(kind: WeatherRecordKind): WeatherProviderQuality {
  return {
    confidence: null,
    label:
      kind === 'observation'
        ? OPEN_METEO_ANALYSIS_QUALITY_LABEL
        : OPEN_METEO_FORECAST_QUALITY_LABEL,
  };
}

const scalar = z.union([z.number(), z.string(), z.null()]);

/**
 * Deliberately permissive about WHICH variables are present (model suffixes
 * make the key set dynamic) and strict about their SHAPE. A body that is not
 * an object, or whose `current` / `daily` blocks are not the documented
 * container shapes, is a malformed response — never repaired into
 * plausible-looking data.
 */
const payloadSchema = z.object({
  current: z.record(z.string(), scalar).optional(),
  current_units: z.record(z.string(), z.string()).optional(),
  daily: z.record(z.string(), z.union([z.array(scalar), z.string()])).optional(),
  daily_units: z.record(z.string(), z.string()).optional(),
});

type ScalarContainer = Record<string, number | string | null>;
type SeriesContainer = Record<string, readonly (number | string | null)[] | string>;
type UnitContainer = Record<string, string>;

function malformed(detail: string): DependencyUnavailableError {
  return new DependencyUnavailableError(
    'integrations.open_meteo.malformed_response',
    `Open-Meteo returned a payload this adapter cannot normalize: ${detail}.`,
  );
}

/**
 * Candidate keys for one requested variable: the plain key first, then the
 * model-suffixed keys in pinned priority order (a multi-model request
 * suffixes every variable with its model name).
 */
function candidateKeys(container: object, variable: string): readonly string[] {
  const keys: string[] = [];
  if (variable in container) {
    keys.push(variable);
  }
  for (const model of OPEN_METEO_PINNED_MODELS) {
    const key = `${variable}_${model}`;
    if (key in container) {
      keys.push(key);
    }
  }
  return keys;
}

/** A value accepted together with the provider's own unit label for it. */
interface UnitedValue {
  readonly value: number;
  readonly unit: string;
}

function accept(
  value: number | string | null | undefined,
  unit: string | undefined,
  expectedUnit: string,
): UnitedValue | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  // No label, or not the SI label the request asked for: the value's unit is
  // unknown or unexpected, so it cannot be recorded as SI.
  if (unit === undefined || unit !== expectedUnit) {
    return null;
  }
  return { value, unit };
}

function pickCurrent(
  current: ScalarContainer,
  units: UnitContainer,
  variable: string,
  expectedUnit: string,
): UnitedValue | null {
  for (const key of candidateKeys(current, variable)) {
    const picked = accept(current[key], units[key], expectedUnit);
    if (picked !== null) {
      return picked;
    }
  }
  return null;
}

function pickDaily(
  daily: SeriesContainer,
  units: UnitContainer,
  variable: string,
  expectedUnit: string,
  index: number,
): UnitedValue | null {
  for (const key of candidateKeys(daily, variable)) {
    const series = daily[key];
    if (series === undefined || typeof series === 'string') {
      continue;
    }
    const picked = accept(series[index], units[key], expectedUnit);
    if (picked !== null) {
      return picked;
    }
  }
  return null;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * The request sends `timezone=UTC`, so timestamps arrive as `YYYY-MM-DD` or
 * `YYYY-MM-DDTHH:MM` with no offset. They are read as UTC explicitly rather
 * than through `new Date(string)`, whose treatment of an offset-less
 * date-time is not what this adapter asked for.
 */
export function parseOpenMeteoUtcTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const minute = ISO_MINUTE.exec(raw);
  if (minute !== null) {
    return utcDate(minute.slice(1));
  }
  const day = ISO_DAY.exec(raw);
  if (day !== null) {
    return utcDate([...day.slice(1), '0', '0']);
  }
  return null;
}

/** `[year, month, day, hour, minute]` as matched digit groups. */
function utcDate(parts: readonly (string | undefined)[]): Date | null {
  const [year, month, day, hour, minute] = parts.map(Number);
  const time = Date.UTC(year ?? NaN, (month ?? NaN) - 1, day ?? NaN, hour ?? NaN, minute ?? NaN);
  return Number.isFinite(time) ? new Date(time) : null;
}

interface MeasurementPicks {
  readonly temperature?: UnitedValue | null;
  readonly precipitation?: UnitedValue | null;
  readonly windSpeed?: UnitedValue | null;
  readonly humidity?: UnitedValue | null;
}

/**
 * Builds one reading, or `null` when nothing survived unit checking — a
 * record with no measurement records nothing, and the domain rejects it
 * anyway (`validateWeatherMeasurements`).
 */
function toReading(
  kind: WeatherRecordKind,
  effectiveAt: Date,
  picks: MeasurementPicks,
  precipitationIntervalSeconds: number | null,
): NormalizedWeatherReading | null {
  const measurements: WeatherMeasurements = {
    temperatureCelsius: picks.temperature?.value ?? null,
    precipitationMm: picks.precipitation?.value ?? null,
    windSpeedMps: picks.windSpeed?.value ?? null,
    humidityPercent: picks.humidity?.value ?? null,
  };
  const sourceUnits: WeatherSourceUnits = {
    temperature: picks.temperature?.unit ?? null,
    precipitation: picks.precipitation?.unit ?? null,
    windSpeed: picks.windSpeed?.unit ?? null,
    humidity: picks.humidity?.unit ?? null,
  };
  const anyPresent = Object.values(measurements).some((value) => value !== null);
  if (!anyPresent) {
    return null;
  }
  return {
    kind,
    effectiveAt,
    measurements,
    // Only meaningful where a precipitation figure survived unit checking;
    // the domain refuses an interval describing an absent measurement.
    precipitationIntervalSeconds:
      measurements.precipitationMm === null ? null : precipitationIntervalSeconds,
    sourceUnits,
    quality: qualityFor(kind),
  };
}

function readCurrent(
  current: ScalarContainer,
  units: UnitContainer,
  now: Date,
): NormalizedWeatherReading | null {
  const effectiveAt = parseOpenMeteoUtcTimestamp(current['time']);
  if (effectiveAt === null) {
    return null;
  }
  // `current` is the latest ELAPSED interval; if a clock skew ever made it
  // later than our own now, it cannot honestly be an observation, and it is
  // dropped rather than reclassified or clamped.
  if (effectiveAt.getTime() > now.getTime()) {
    return null;
  }
  return toReading(
    'observation',
    effectiveAt,
    {
      temperature: pickCurrent(current, units, 'temperature_2m', EXPECTED_UNIT_LABELS.temperature),
      precipitation: pickCurrent(
        current,
        units,
        'precipitation',
        EXPECTED_UNIT_LABELS.precipitation,
      ),
      windSpeed: pickCurrent(current, units, 'wind_speed_10m', EXPECTED_UNIT_LABELS.windSpeed),
      humidity: pickCurrent(current, units, 'relative_humidity_2m', EXPECTED_UNIT_LABELS.humidity),
    },
    OPEN_METEO_CURRENT_PRECIPITATION_INTERVAL_SECONDS,
  );
}

function readDaily(
  daily: SeriesContainer,
  units: UnitContainer,
  now: Date,
): readonly NormalizedWeatherReading[] {
  const times = daily['time'];
  if (times === undefined || typeof times === 'string') {
    throw malformed('the daily block carries no time series');
  }

  const readings: NormalizedWeatherReading[] = [];
  for (const [index, rawTime] of times.entries()) {
    const effectiveAt = parseOpenMeteoUtcTimestamp(rawTime);
    if (effectiveAt === null) {
      continue;
    }
    // A daily sum is only about the past once its whole 24-hour period has
    // elapsed; the current day still contains hours the model has not
    // observed, so it stays a forecast.
    const kind: WeatherRecordKind =
      effectiveAt.getTime() + DAY_MS <= now.getTime() ? 'observation' : 'forecast';
    const reading = toReading(
      kind,
      effectiveAt,
      {
        precipitation: pickDaily(
          daily,
          units,
          'precipitation_sum',
          EXPECTED_UNIT_LABELS.precipitation,
          index,
        ),
      },
      OPEN_METEO_DAILY_PRECIPITATION_INTERVAL_SECONDS,
    );
    if (reading !== null) {
      readings.push(reading);
    }
  }
  return readings;
}

/**
 * Normalizes one Open-Meteo response body. `now` is the adapter's injected
 * clock reading, used only to tell an elapsed period from an unfinished one.
 *
 * Partial data degrades row by row: an unparsable timestamp, an absent
 * value, or a unit label that is not the requested SI one drops that one
 * value or row and keeps the rest. Only a payload whose STRUCTURE is not the
 * documented one throws — the port's "may reject with anything", which
 * `refresh-garden-weather.ts` turns into a typed degradation.
 */
export function parseOpenMeteoPayload(
  body: unknown,
  now: Date,
): readonly NormalizedWeatherReading[] {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed('its top-level shape is not the documented forecast response');
  }

  const readings: NormalizedWeatherReading[] = [];
  const { current, current_units: currentUnits, daily, daily_units: dailyUnits } = parsed.data;

  if (current !== undefined) {
    const reading = readCurrent(current, currentUnits ?? {}, now);
    if (reading !== null) {
      readings.push(reading);
    }
  }
  if (daily !== undefined) {
    readings.push(...readDaily(daily, dailyUnits ?? {}, now));
  }

  return readings;
}
