/**
 * Kysely implementation of `WeatherRecordRepository` over
 * `integrations.weather_record`.
 *
 * Append-only: `insertMany` is the table's only write, one statement per
 * fetch batch (atomic without an explicit transaction). Reads map rows back
 * through a shape-checked `source_units` parse — a jsonb column is never
 * trusted by cast, the same posture the migration's consistency CHECK takes
 * on the way in.
 *
 * BECAUSE THE TABLE IS APPEND-ONLY, THE SAME PERIOD IS STORED MANY TIMES.
 * Open-Meteo is asked for `past_days` of daily totals on every refresh, and
 * every elapsed day in that block is persisted again with an identical
 * `effective_at` (open-meteo-payload.ts, `readDaily`). That is correct as
 * history — a later fetch may revise a day's figure, and this table keeps
 * both readings — but it means a read that SUMS the rows counts one day once
 * per sweep that has run. Observed on dev as "175.2 mm ... measured across
 * 18 of 7 days" against a true 58.4 mm: three sweeps, three copies.
 *
 * `listElapsedPrecipitation` therefore collapses to one row per period HERE,
 * in the shared read, not in its callers. Three consumers already accumulate
 * over it — the rule engine's watering check, the per-plant care view and the
 * garden weather panel — and fixing two of them while leaving the third is
 * how they drift apart again. One day, one total is a property of the data.
 *
 * The failure direction this closes matters: an inflated total makes
 * `watering.dry-spell-check` UNDER-fire, staying silent on a garden that is
 * genuinely short of water. Silence looks identical whether it is right or
 * wrong, so nothing outside this query could have caught it.
 *
 * Source: migrations/1785700000000_integrations-weather-baseline.sql.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  WeatherRecord,
  WeatherRecordKind,
  WeatherSourceUnits,
} from '../domain/weather-record.js';
import type {
  PrecipitationEntry,
  WeatherRecordRepository,
} from '../application/weather-record-repository.js';
import type { WeatherRecordRow } from './schema.js';

function parseSourceUnits(raw: unknown, recordId: string): WeatherSourceUnits {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InternalError(
      'integrations.weather_record.source_units.corrupt',
      `Weather record '${recordId}' has a non-object source_units value.`,
    );
  }
  const object = raw as Record<string, unknown>;
  const field = (key: string): string | null => {
    const value = object[key] ?? null;
    if (value !== null && typeof value !== 'string') {
      throw new InternalError(
        'integrations.weather_record.source_units.corrupt',
        `Weather record '${recordId}' has a non-string source_units.${key}.`,
      );
    }
    return value;
  };
  return {
    temperature: field('temperature'),
    precipitation: field('precipitation'),
    windSpeed: field('windSpeed'),
    humidity: field('humidity'),
  };
}

function toWeatherRecord(row: Selectable<WeatherRecordRow>): WeatherRecord {
  return {
    id: row.id,
    gardenId: row.garden_id,
    providerKey: row.provider_key,
    kind: row.record_kind as WeatherRecordKind,
    effectiveAt: row.effective_at,
    fetchedAt: row.fetched_at,
    location: { latitude: row.latitude, longitude: row.longitude },
    measurements: {
      temperatureCelsius: row.temperature_celsius,
      precipitationMm: row.precipitation_mm,
      windSpeedMps: row.wind_speed_mps,
      humidityPercent: row.humidity_percent,
    },
    precipitationIntervalSeconds: row.precipitation_interval_seconds,
    sourceUnits: parseSourceUnits(row.source_units, row.id),
    quality: { confidence: row.provider_confidence, label: row.provider_quality_label },
    licenseNote: row.license_note,
    attributionText: row.attribution_text,
    createdAt: row.created_at,
  };
}

export class KyselyWeatherRecordRepository implements WeatherRecordRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insertMany(records: readonly WeatherRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.db
      .insertInto('integrations.weather_record')
      .values(
        records.map((record) => ({
          id: record.id,
          garden_id: record.gardenId,
          provider_key: record.providerKey,
          record_kind: record.kind,
          effective_at: record.effectiveAt,
          fetched_at: record.fetchedAt,
          latitude: record.location.latitude,
          longitude: record.location.longitude,
          temperature_celsius: record.measurements.temperatureCelsius,
          precipitation_mm: record.measurements.precipitationMm,
          wind_speed_mps: record.measurements.windSpeedMps,
          humidity_percent: record.measurements.humidityPercent,
          precipitation_interval_seconds: record.precipitationIntervalSeconds,
          source_units: JSON.stringify(record.sourceUnits),
          provider_confidence: record.quality.confidence,
          provider_quality_label: record.quality.label,
          license_note: record.licenseNote,
          attribution_text: record.attributionText,
          created_at: record.createdAt,
        })),
      )
      .execute();
  }

  async findLatest(gardenId: Uuid, kind: WeatherRecordKind): Promise<WeatherRecord | null> {
    const row = await this.db
      .selectFrom('integrations.weather_record')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('record_kind', '=', kind)
      .orderBy('fetched_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? null : toWeatherRecord(row);
  }

  /** Effective order, not retrieval order — see the port's own note on why both reads exist. */
  async findLatestObservation(gardenId: Uuid): Promise<WeatherRecord | null> {
    const row = await this.db
      .selectFrom('integrations.weather_record')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('record_kind', '=', 'observation')
      // The moment the reading is ABOUT decides first. A point reading is
      // dated at the current period; every daily total is dated at a
      // midnight that has already passed, so the point reading wins without
      // needing a column that distinguishes them.
      .orderBy('effective_at', 'desc')
      // Then the same retrieval precedence `findLatest` uses, so two fetches
      // of the same moment resolve to the most recently fetched one rather
      // than flapping.
      .orderBy('fetched_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? null : toWeatherRecord(row);
  }

  /** Nearest upcoming first, most recent past as the fallback — see the port's own note. */
  async findNextForecast(gardenId: Uuid, now: Date): Promise<WeatherRecord | null> {
    const upcoming = await this.db
      .selectFrom('integrations.weather_record')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('record_kind', '=', 'forecast')
      .where('effective_at', '>', now)
      .orderBy('effective_at', 'asc')
      .orderBy('fetched_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (upcoming !== undefined) {
      return toWeatherRecord(upcoming);
    }

    // Every stored forecast has been overtaken. Serve the most recent one so
    // the caller can label it stale, rather than reporting no forecast at all.
    const overtaken = await this.db
      .selectFrom('integrations.weather_record')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('record_kind', '=', 'forecast')
      .orderBy('effective_at', 'desc')
      .orderBy('fetched_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return overtaken === undefined ? null : toWeatherRecord(overtaken);
  }

  async listElapsedPrecipitation(
    gardenId: Uuid,
    intervalSeconds: number,
    since: Date,
  ): Promise<readonly PrecipitationEntry[]> {
    const rows = await this.db
      .selectFrom('integrations.weather_record')
      // ONE ROW PER PERIOD — see this class's header for why the collapse
      // lives here rather than in each caller. `effective_at` alone is the
      // period key because every predicate below has already fixed the
      // garden, the kind and the interval class, so two surviving rows with
      // the same `effective_at` describe the same span of time twice.
      //
      // NOT a truncation to the calendar day: this read is parameterized by
      // `intervalSeconds`, and collapsing hourly totals per day would throw
      // away twenty-three hours of rain. For the daily class the two happen
      // to coincide, which is where "one day, one total" comes from.
      .distinctOn('effective_at')
      .select(['effective_at', 'precipitation_mm'])
      .where('garden_id', '=', gardenId)
      // Elapsed only — a forecast total is a prediction, and summing it into
      // rainfall that has fallen would claim water the soil never received.
      .where('record_kind', '=', 'observation')
      .where('precipitation_interval_seconds', '=', intervalSeconds)
      .where('precipitation_mm', 'is not', null)
      .where('effective_at', '>=', since)
      // The leading key must match `distinctOn`; the rest picks WHICH
      // duplicate survives — the most recently recorded reading of that
      // period, the same precedence `findLatest` uses to resolve
      // contradictory records.
      .orderBy('effective_at', 'asc')
      .orderBy('fetched_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();

    return rows.map((row) => ({
      effectiveAt: row.effective_at,
      // The `is not null` predicate above already excluded the null case;
      // this narrows the column's nullable type without a cast.
      precipitationMm: row.precipitation_mm ?? 0,
    }));
  }
}
