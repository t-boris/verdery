/**
 * Normalized weather record: external-integrations.md section 5's field
 * list as an immutable, append-only domain value — the provider-neutral
 * shape every weather adapter's output is converted into before anything
 * else in this system may read it ("Provider SDK and payload types remain
 * inside the adapter", section 2).
 *
 * Unit system: every stored measurement is normalized to ONE documented SI
 * profile — temperature in degrees Celsius, precipitation depth in
 * millimetres, wind speed in metres per second, relative humidity in
 * percent. `sourceUnits` carries the conversion provenance section 5
 * requires: the provider's own unit label for every present measurement,
 * recorded even when the provider already reported SI. Precipitation's
 * accumulation interval is provider-defined and deliberately NOT normalized
 * here — no document defines a canonical interval, and inventing one would
 * misstate provider data; a real vendor adapter (P0-PROV-01) documents its
 * interval when it exists.
 *
 * Anchoring: weather belongs to a garden, located by the exact WGS84
 * coordinates the fetch used (snapshotted, so a later georeference change
 * cannot re-attribute historical weather). Freshness is deliberately not a
 * field — it decays with wall-clock time and is derived at read time by
 * `weather-freshness.ts`.
 *
 * Source: migrations/1785700000000_integrations-weather-baseline.sql,
 * `integrations.weather_record`;
 * architecture/external-integrations.md, sections "2. Integration Boundary"
 * and "5. Weather".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** The one internal unit system. CHECK-pinned in the migration; a second system would be a reviewed migration, not a runtime option. */
export const WEATHER_UNIT_SYSTEM = 'si';

/** Section 5's "Observation/forecast effective time", split into the kind and `effectiveAt`. */
export type WeatherRecordKind = 'observation' | 'forecast';

/** WGS84 coordinates the fetch actually used. */
export interface WeatherLocation {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * The four normalized readings. Each is nullable — "Missing facts remain
 * missing" (recommendations-and-ai.md section 4) applies to provider data
 * too — but at least one must be present: a record with no reading records
 * nothing.
 */
export interface WeatherMeasurements {
  readonly temperatureCelsius: number | null;
  readonly precipitationMm: number | null;
  readonly windSpeedMps: number | null;
  readonly humidityPercent: number | null;
}

/**
 * Conversion provenance: the provider's own unit label per measurement
 * field — non-blank exactly when the matching measurement is present, null
 * when it is absent. Mirrored physically by the migration's
 * `weather_record_source_units_consistency_check`.
 */
export interface WeatherSourceUnits {
  readonly temperature: string | null;
  readonly precipitation: string | null;
  readonly windSpeed: string | null;
  readonly humidity: string | null;
}

/** Section 5's "Confidence or provider quality where supplied" — both halves optional, never invented. */
export interface WeatherProviderQuality {
  /** Normalized confidence in [0, 1], when the provider supplies one. */
  readonly confidence: number | null;
  /** The provider's own quality category label, when it supplies one. */
  readonly label: string | null;
}

export interface WeatherRecord {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  /** The application-owned registry key of the adapter that produced this row — never a provider SDK identifier. */
  readonly providerKey: string;
  readonly kind: WeatherRecordKind;
  /** The moment the reading is ABOUT (observation time, or forecast target time). */
  readonly effectiveAt: Date;
  /** The moment this system retrieved it — the basis for freshness. */
  readonly fetchedAt: Date;
  readonly location: WeatherLocation;
  readonly measurements: WeatherMeasurements;
  readonly sourceUnits: WeatherSourceUnits;
  readonly quality: WeatherProviderQuality;
  /** License and redistribution constraints snapshot, from the registry entry that produced the row. */
  readonly licenseNote: string;
  readonly attributionText: string | null;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

/** Mirrors `weather_record_provider_key_check`, plus the usual all-spaces gap a bare non-blank CHECK leaves open. */
export function validateWeatherProviderKey(rawProviderKey: string): string {
  const providerKey = rawProviderKey.trim();
  if (providerKey.length === 0) {
    throw invalid(
      'providerKey must not be blank.',
      'integrations.weather_record.provider_key.blank',
      '/providerKey',
    );
  }
  return providerKey;
}

/** Mirrors the latitude/longitude range CHECKs; also rejects NaN/Infinity, which a CHECK cannot see coming from JS. */
export function validateWeatherLocation(location: WeatherLocation): WeatherLocation {
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw invalid(
      'latitude must be a finite number between -90 and 90.',
      'integrations.weather_record.latitude.invalid',
      '/location/latitude',
    );
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw invalid(
      'longitude must be a finite number between -180 and 180.',
      'integrations.weather_record.longitude.invalid',
      '/location/longitude',
    );
  }
  return { latitude, longitude };
}

interface MeasurementRule {
  readonly measurement: keyof WeatherMeasurements;
  readonly sourceUnit: keyof WeatherSourceUnits;
  readonly minimum: number | null;
  readonly maximum: number | null;
}

const MEASUREMENT_RULES: readonly MeasurementRule[] = [
  { measurement: 'temperatureCelsius', sourceUnit: 'temperature', minimum: null, maximum: null },
  { measurement: 'precipitationMm', sourceUnit: 'precipitation', minimum: 0, maximum: null },
  { measurement: 'windSpeedMps', sourceUnit: 'windSpeed', minimum: 0, maximum: null },
  { measurement: 'humidityPercent', sourceUnit: 'humidity', minimum: 0, maximum: 100 },
];

/**
 * Mirrors the measurement range CHECKs, the at-least-one-measurement CHECK,
 * and the source-units consistency CHECK: every present measurement must be
 * finite, within its physical range, and paired with a non-blank source
 * unit; every absent one must have a null source unit.
 */
export function validateWeatherMeasurements(
  measurements: WeatherMeasurements,
  sourceUnits: WeatherSourceUnits,
): void {
  let anyPresent = false;

  for (const rule of MEASUREMENT_RULES) {
    const value = measurements[rule.measurement];
    const unit = sourceUnits[rule.sourceUnit];

    if (value === null) {
      if (unit !== null) {
        throw invalid(
          `sourceUnits.${rule.sourceUnit} must be null when ${rule.measurement} is absent.`,
          'integrations.weather_record.source_units.inconsistent',
          `/sourceUnits/${rule.sourceUnit}`,
        );
      }
      continue;
    }

    anyPresent = true;
    if (
      !Number.isFinite(value) ||
      (rule.minimum !== null && value < rule.minimum) ||
      (rule.maximum !== null && value > rule.maximum)
    ) {
      throw invalid(
        `${rule.measurement} is out of range.`,
        `integrations.weather_record.${rule.measurement}.invalid`,
        `/measurements/${rule.measurement}`,
      );
    }
    if (unit === null || unit.trim().length === 0) {
      throw invalid(
        `sourceUnits.${rule.sourceUnit} must name the provider's unit for ${rule.measurement}.`,
        'integrations.weather_record.source_units.missing',
        `/sourceUnits/${rule.sourceUnit}`,
      );
    }
  }

  if (!anyPresent) {
    throw invalid(
      'At least one measurement must be present.',
      'integrations.weather_record.measurements.empty',
      '/measurements',
    );
  }
}

/** Mirrors `weather_record_confidence_check` and `weather_record_quality_label_check`. */
export function validateWeatherQuality(quality: WeatherProviderQuality): WeatherProviderQuality {
  if (
    quality.confidence !== null &&
    (!Number.isFinite(quality.confidence) || quality.confidence < 0 || quality.confidence > 1)
  ) {
    throw invalid(
      'quality.confidence must be a finite number between 0 and 1.',
      'integrations.weather_record.confidence.invalid',
      '/quality/confidence',
    );
  }
  const label = quality.label?.trim() ?? null;
  if (label !== null && label.length === 0) {
    throw invalid(
      'quality.label must not be blank when present.',
      'integrations.weather_record.quality_label.blank',
      '/quality/label',
    );
  }
  return { confidence: quality.confidence, label };
}

export interface CreateWeatherRecordInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly rawProviderKey: string;
  readonly kind: WeatherRecordKind;
  readonly effectiveAt: Date;
  readonly fetchedAt: Date;
  readonly location: WeatherLocation;
  readonly measurements: WeatherMeasurements;
  readonly sourceUnits: WeatherSourceUnits;
  readonly quality: WeatherProviderQuality;
  readonly rawLicenseNote: string;
  readonly attributionText: string | null;
  readonly now: Date;
}

/**
 * Constructs a normalized weather record, enforcing every migration CHECK
 * as a clean `ValidationError` before the row exists — including the
 * cannot-observe-the-future rule (`weather_record_observation_not_future_check`).
 */
export function createWeatherRecord(input: CreateWeatherRecordInput): WeatherRecord {
  const licenseNote = input.rawLicenseNote.trim();
  if (licenseNote.length === 0) {
    throw invalid(
      'licenseNote must not be blank.',
      'integrations.weather_record.license_note.blank',
      '/licenseNote',
    );
  }
  const attributionText = input.attributionText?.trim() ?? null;
  if (attributionText !== null && attributionText.length === 0) {
    throw invalid(
      'attributionText must not be blank when present.',
      'integrations.weather_record.attribution_text.blank',
      '/attributionText',
    );
  }
  if (input.kind === 'observation' && input.effectiveAt.getTime() > input.fetchedAt.getTime()) {
    throw invalid(
      "An observation's effectiveAt must not be after its fetchedAt.",
      'integrations.weather_record.effective_at.future_observation',
      '/effectiveAt',
    );
  }
  validateWeatherMeasurements(input.measurements, input.sourceUnits);

  return {
    id: input.id,
    gardenId: input.gardenId,
    providerKey: validateWeatherProviderKey(input.rawProviderKey),
    kind: input.kind,
    effectiveAt: input.effectiveAt,
    fetchedAt: input.fetchedAt,
    location: validateWeatherLocation(input.location),
    measurements: input.measurements,
    sourceUnits: input.sourceUnits,
    quality: validateWeatherQuality(input.quality),
    licenseNote,
    attributionText,
    createdAt: input.now,
  };
}
