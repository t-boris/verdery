import type { ColumnType, Generated } from 'kysely';

export interface TaxonomyReferenceRow {
  id: string;
  scientific_name: string;
  common_name: string | null;
  variety_name: string | null;
  /** P9D-SEASON-DATA-01: additive, nullable — see `domain/taxonomy-reference.ts`'s own header. */
  family: string | null;
  genus: string | null;
  source: string;
  created_by_profile_id: string | null;
  created_at: Generated<Date>;
}

/**
 * `acquisition_date` is a `date` column, read as the raw `'YYYY-MM-DD'`
 * string — see `platform/database/pg-date-parser.ts` for why, and for the
 * type parser that makes this row type match what the driver actually
 * returns.
 */
export interface PlantRow {
  id: string;
  garden_id: string;
  garden_area_map_object_id: string | null;
  placement_map_object_id: string | null;
  display_name: string;
  taxonomy_reference_id: string | null;
  variety_label: string | null;
  accepted_identification_id: string | null;
  acquisition_date: string | null;
  acquisition_date_type: string | null;
  grouping_kind: Generated<string>;
  quantity: number | null;
  lifecycle_stage: Generated<string>;
  status: Generated<string>;
  condition_note: string | null;
  care_guidance_note: string | null;
  // A JS number, not the string node-postgres would return for bigint: see
  // the identical note on gardens_mapping.garden's own revision column. This
  // one is a plain `integer`, not `bigint`, so no custom type parser is
  // needed for it — only `plant_revision`'s own `sequence`/`revision`
  // columns are `bigint`.
  revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlantPhotoRow {
  id: string;
  plant_id: string;
  media_id: string;
  is_primary: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface PlantCandidatePhotoRow {
  id: string;
  candidate_id: string;
  media_id: string;
  is_primary: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface PlantIdentificationRow {
  id: string;
  plant_id: string;
  plant_photo_id: string;
  suggested_taxonomy_id: string | null;
  suggested_common_name: string | null;
  suggested_scientific_name: string | null;
  suggested_variety_label: string | null;
  suggested_lifecycle_stage: string | null;
  suggested_condition_note: string | null;
  suggested_care_guidance_note: string | null;
  suggested_acquisition_date: string | null;
  /**
   * `numeric(4,3)` — node-postgres returns this OID (1700) as a string by
   * default, unlike `double precision` (which every other fractional column
   * in this schema uses instead, sidestepping the issue entirely — see
   * `gardens_mapping.garden_object.confidence`). This is the one column in
   * the whole schema that is a real `numeric`, so rather than a global type
   * parser (which would apply to every `numeric` column any future module
   * ever adds), `ColumnType` models the asymmetry directly: `SelectType`
   * reflects what the driver actually returns, `InsertType`/`UpdateType`
   * accept the plain JS number this module always has in hand (`pg`
   * serializes a bound number parameter via `.toString()`, so this is a
   * correctness-neutral convenience, not a behavior change on the write
   * side). See `persistence/kysely-plant-identification-repository.ts` for
   * where the read-side string is converted back to a number.
   */
  confidence_score: ColumnType<string, number, number>;
  created_at: Generated<Date>;
}

/**
 * Append-only journal: `sequence` is the physical insertion order, `revision`
 * is the plant's own logical revision at the time this row was written —
 * structurally identical to `gardens_mapping.garden_object_revision`.
 *
 * `garden_area_map_object_id`/`placement_map_object_id`/
 * `taxonomy_reference_id` (P9D-SEASON-DATA-01): nullable placement/taxon
 * snapshot columns, populated only by the command that changed the field
 * they carry — see `migrations/1787100000000_taxonomy-seasonal-facts-and-
 * bed-history.sql`'s own header for exactly which commands populate which
 * columns, and `application/bed-occupancy-history.ts` for the read query
 * this snapshot exists to serve.
 */
export interface PlantRevisionRow {
  sequence: Generated<number>;
  plant_id: string;
  revision: number;
  command_type: string;
  lifecycle_stage: string | null;
  status: string | null;
  garden_area_map_object_id: string | null;
  placement_map_object_id: string | null;
  taxonomy_reference_id: string | null;
  actor_profile_id: string;
  recorded_at: Generated<Date>;
}

/**
 * One row per (taxonomyReferenceId, hemisphere) — see
 * `domain/taxonomy-seasonal-fact.ts`'s own header for the full shape and
 * ADR-0013 provenance reasoning. No `Generated<>` wrapper is needed beyond
 * `created_at`: this table has no other server-defaulted column and no
 * update path (see the migration's own "NO `revision` COLUMN" note).
 */
export interface TaxonomySeasonalFactRow {
  id: string;
  taxonomy_reference_id: string;
  hemisphere: string;
  sow_indoors_start_month: number | null;
  sow_indoors_end_month: number | null;
  sow_outdoors_start_month: number | null;
  sow_outdoors_end_month: number | null;
  transplant_start_month: number | null;
  transplant_end_month: number | null;
  harvest_start_month: number | null;
  harvest_end_month: number | null;
  days_to_maturity_min: number | null;
  days_to_maturity_max: number | null;
  succession_interval_days: number | null;
  rotation_rest_seasons: number | null;
  authoring_method: string;
  source_citation: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_on: string | null;
  created_at: Generated<Date>;
}

/**
 * P11-DATA-01 — see migrations/1787600000000_plant-candidates-and-
 * conversion.sql's own header for the full field-by-field reasoning.
 */
export interface PlantCandidateRow {
  id: string;
  garden_id: string;
  proposed_garden_area_map_object_id: string | null;
  proposed_placement_map_object_id: string | null;
  display_name: string;
  taxonomy_reference_id: string | null;
  variety_label: string | null;
  grouping_kind: Generated<string>;
  quantity: number | null;
  status: Generated<string>;
  rationale_note: string | null;
  priority: string | null;
  /** `numeric(10,2)` — read as the string node-postgres returns for `numeric`, mirroring `PlantIdentificationRow.confidence_score`'s own note; converted to/from a JS number at the repository boundary, never a global type parser. */
  price_amount: ColumnType<string | null, number | null, number | null>;
  price_currency: string | null;
  purchase_source: string | null;
  alternative_to_candidate_id: string | null;
  photo_analysis: unknown;
  revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CandidateConversionRow {
  id: string;
  candidate_id: string;
  plant_id: string;
  converted_by_profile_id: string;
  converted_at: Generated<Date>;
  created_at: Generated<Date>;
}

/** `result`'s internal shape is defined and validated by `P11-SUIT-01`'s own application-layer schema, not here — see the migration's own header. */
export interface CandidateSuitabilityAssessmentRow {
  id: string;
  candidate_id: string;
  result: unknown;
  created_at: Generated<Date>;
}

/** P11-DATA-02 — see migrations/1787700000000_plant-taxon-knowledge-profile.sql's own header. */
export interface TaxonomyNameRow {
  id: string;
  taxonomy_reference_id: string;
  name_kind: string;
  locale: string | null;
  name_text: string;
  source: string;
  provider_key: string | null;
  created_at: Generated<Date>;
}

/** `resolved`'s internal shape is defined and validated by this module's own `plant-profile-version.ts`, not here — see the migration's own header. */
export interface PlantProfileVersionRow {
  id: string;
  taxonomy_reference_id: string;
  resolved: unknown;
  is_partial: Generated<boolean>;
  created_at: Generated<Date>;
}

/** One garden's acceptance of one seasonal fact — see the migration's own header for why the decision is per garden while the content stays shared. */
export interface GardenSeasonalFactAcceptanceRow {
  id: string;
  garden_id: string;
  taxonomy_seasonal_fact_id: string;
  accepted_by_profile_id: string;
  accepted_on: string;
  created_at: Generated<Date>;
}

export interface PlantsInventoryDatabaseSchema {
  'plants_inventory.taxonomy_reference': TaxonomyReferenceRow;
  'plants_inventory.taxonomy_seasonal_fact': TaxonomySeasonalFactRow;
  'plants_inventory.garden_seasonal_fact_acceptance': GardenSeasonalFactAcceptanceRow;
  'plants_inventory.plant': PlantRow;
  'plants_inventory.plant_photo': PlantPhotoRow;
  'plants_inventory.plant_identification': PlantIdentificationRow;
  'plants_inventory.plant_revision': PlantRevisionRow;
  'plants_inventory.plant_candidate': PlantCandidateRow;
  'plants_inventory.plant_candidate_photo': PlantCandidatePhotoRow;
  'plants_inventory.candidate_conversion': CandidateConversionRow;
  'plants_inventory.candidate_suitability_assessment': CandidateSuitabilityAssessmentRow;
  'plants_inventory.taxonomy_name': TaxonomyNameRow;
  'plants_inventory.plant_profile_version': PlantProfileVersionRow;
}
