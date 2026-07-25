/**
 * Row types for the tables the integrations module owns.
 *
 * `source_units` is `jsonb`, typed `unknown` on read like
 * `tasks_recommendations.recommendation_evidence.fact_value` — the
 * repository validates its shape when mapping to the domain's
 * `WeatherSourceUnits`, never trusts a cast.
 *
 * Source: migrations/1785700000000_integrations-weather-baseline.sql.
 */

import type { Generated } from 'kysely';

export interface WeatherRecordRow {
  id: string;
  garden_id: string;
  provider_key: string;
  record_kind: string;
  effective_at: Date;
  fetched_at: Date;
  latitude: number;
  longitude: number;
  temperature_celsius: number | null;
  precipitation_mm: number | null;
  wind_speed_mps: number | null;
  humidity_percent: number | null;
  unit_system: Generated<string>;
  source_units: unknown;
  provider_confidence: number | null;
  provider_quality_label: string | null;
  license_note: string;
  attribution_text: string | null;
  created_at: Generated<Date>;
}

export interface ProviderQuotaUsageRow {
  provider_key: string;
  window_kind: string;
  window_start: Date;
  call_count: Generated<number>;
  updated_at: Generated<Date>;
}

export interface IntegrationsDatabaseSchema {
  'integrations.weather_record': WeatherRecordRow;
  'integrations.provider_quota_usage': ProviderQuotaUsageRow;
}
