/**
 * Row types for the tables the integrations module owns.
 *
 * `source_units` is `jsonb`, typed `unknown` on read like
 * `tasks_recommendations.recommendation_evidence.fact_value` — the
 * repository validates its shape when mapping to the domain's
 * `WeatherSourceUnits`, never trusts a cast.
 *
 * Source: migrations/1785700000000_integrations-weather-baseline.sql;
 *         migrations/1785900000000_integrations-plant-content-baseline.sql.
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

export interface PlantTaxonomyMappingRow {
  id: string;
  taxonomy_reference_id: string;
  provider_key: string;
  provider_taxon_id: string;
  provider_scientific_name: string | null;
  confidence: number | null;
  verification_state: Generated<string>;
  state_note: string | null;
  state_changed_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface PlantContentRecordRow {
  id: string;
  provider_key: string;
  provider_taxon_id: string;
  provider_record_id: string | null;
  provider_content_version: string | null;
  content_language: string;
  description: string | null;
  care_guidance: string | null;
  fetched_at: Date;
  license_note: string;
  attribution_text: string | null;
  jurisdiction: string | null;
  presentation_note: string;
  created_at: Generated<Date>;
}

export interface IntegrationsDatabaseSchema {
  'integrations.weather_record': WeatherRecordRow;
  'integrations.provider_quota_usage': ProviderQuotaUsageRow;
  'integrations.plant_taxonomy_mapping': PlantTaxonomyMappingRow;
  'integrations.plant_content_record': PlantContentRecordRow;
}
