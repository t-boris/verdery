import type { ColumnType, Generated } from 'kysely';

export interface TaxonomyReferenceRow {
  id: string;
  scientific_name: string;
  common_name: string | null;
  variety_name: string | null;
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

export interface PlantIdentificationRow {
  id: string;
  plant_id: string;
  plant_photo_id: string;
  suggested_taxonomy_id: string | null;
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
 */
export interface PlantRevisionRow {
  sequence: Generated<number>;
  plant_id: string;
  revision: number;
  command_type: string;
  lifecycle_stage: string | null;
  status: string | null;
  actor_profile_id: string;
  recorded_at: Generated<Date>;
}

export interface PlantsInventoryDatabaseSchema {
  'plants_inventory.taxonomy_reference': TaxonomyReferenceRow;
  'plants_inventory.plant': PlantRow;
  'plants_inventory.plant_photo': PlantPhotoRow;
  'plants_inventory.plant_identification': PlantIdentificationRow;
  'plants_inventory.plant_revision': PlantRevisionRow;
}
