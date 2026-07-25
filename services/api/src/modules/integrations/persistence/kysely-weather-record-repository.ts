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
import type { WeatherRecordRepository } from '../application/weather-record-repository.js';
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
}
