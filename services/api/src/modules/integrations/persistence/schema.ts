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
  /** What `precipitation_mm` is a sum over. Null on rows written before the interval was recorded — never assume one. */
  precipitation_interval_seconds: number | null;
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

/** P11-DATA-02 — see migrations/1787700000000_plant-taxon-knowledge-profile.sql's own header. */
export interface PlantFactAssertionRow {
  id: string;
  provider_key: string;
  provider_taxon_id: string;
  fact_key: string;
  fact_value: unknown;
  unit: string | null;
  confidence: number | null;
  geographic_scope: string | null;
  authoring_method: string;
  source_citation: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_on: string | null;
  fetched_at: Date | null;
  created_at: Generated<Date>;
}

export interface PlantDistributionAssertionRow {
  id: string;
  provider_key: string;
  provider_taxon_id: string;
  region: string;
  status: string;
  confidence: number | null;
  authoring_method: string;
  source_citation: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_on: string | null;
  fetched_at: Date | null;
  created_at: Generated<Date>;
}

export interface PlantMediaAssetRow {
  id: string;
  provider_key: string;
  provider_taxon_id: string;
  media_id: string | null;
  source_url: string | null;
  organ: string | null;
  inferred_organ: Generated<boolean>;
  license: string;
  attribution_text: string | null;
  creator: string | null;
  rights_holder: string | null;
  observed_at: Date | null;
  generalized_location: string | null;
  ingestion_state: Generated<string>;
  created_at: Generated<Date>;
}

export interface IntegrationsDatabaseSchema {
  'integrations.weather_record': WeatherRecordRow;
  'integrations.provider_quota_usage': ProviderQuotaUsageRow;
  'integrations.plant_taxonomy_mapping': PlantTaxonomyMappingRow;
  'integrations.plant_content_record': PlantContentRecordRow;
  'integrations.plant_fact_assertion': PlantFactAssertionRow;
  'integrations.plant_distribution_assertion': PlantDistributionAssertionRow;
  'integrations.plant_media_asset': PlantMediaAssetRow;
}
