import type { Generated } from 'kysely';
import type { JsonValue } from '../../../platform/database/platform-schema.js';

export interface GardenRow {
  id: string;
  name: string;
  lifecycle_state: string;
  // A JS number, not the string node-postgres would return for bigint: see
  // the identical note on identity_access.profile's revision column.
  revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deletion_requested_at: Date | null;
}

/** Table lives in the `collaboration` schema; see membership-repository.ts for why this module owns it in Phase 2. */
export interface MembershipRow {
  id: string;
  garden_id: string;
  profile_id: string;
  role: string;
  state: string;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * `kind` and `axis_convention` are database-defaulted single-value columns
 * today (the migration's `CHECK` pins each to its one current value) — still
 * `Generated<string>`, not a literal type, because Kysely row types describe
 * what a column returns, and a future kind is a migration away, not a type
 * change here.
 */
export interface CoordinateSpaceRow {
  id: string;
  garden_id: string;
  kind: Generated<string>;
  axis_convention: Generated<string>;
  origin_description: string;
  created_at: Generated<Date>;
}

/**
 * `local_anchor` and `geographic_anchor` are PostGIS `geometry(Point, *)`
 * columns, read and written through `persistence/postgis-geometry.ts` like
 * every other geometry column in this module — never a Kysely-native type.
 */
export interface GeoreferenceRow {
  id: string;
  garden_id: string;
  coordinate_space_id: string;
  local_anchor: string;
  geographic_anchor: string;
  rotation_degrees: Generated<number>;
  scale_correction: Generated<number>;
  accuracy_metres: number | null;
  provenance: string;
  method: string;
  revision: Generated<number>;
  valid_from: Generated<Date>;
  valid_until: Date | null;
  created_by_profile_id: string;
  created_at: Generated<Date>;
}

/**
 * `geometry` is a PostGIS `geometry(Geometry, 0)` column, always read as
 * `ST_AsGeoJSON(geometry)::text` and written as `ST_GeomFromGeoJSON($1)` —
 * see `persistence/postgis-geometry.ts`. Kysely has no PostGIS-aware column
 * type, so this is `string` at the row-type level: the raw GeoJSON text, not
 * the parsed `Geometry` the application layer works with.
 */
export interface GardenObjectRow {
  id: string;
  garden_id: string;
  coordinate_space_id: string;
  category: string;
  geometry: string;
  label: string | null;
  provenance: string;
  confidence: number | null;
  lifecycle_state: Generated<string>;
  current_revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface StructureDetailsRow {
  garden_object_id: string;
  structure_kind: string;
  height_metres: number | null;
}

export interface FenceDetailsRow {
  garden_object_id: string;
  fence_kind: string;
  height_metres: number | null;
}

export interface GateDetailsRow {
  garden_object_id: string;
  fence_object_id: string;
  width_metres: number | null;
}

export interface ZoneDetailsRow {
  garden_object_id: string;
  zone_kind: string;
}

export interface BedDetailsRow {
  garden_object_id: string;
  bed_kind: string;
  soil_notes: string | null;
}

/** `canopy_geometry` follows the same GeoJSON-text convention as `GardenObjectRow.geometry`; `null` means no canopy outline yet. */
export interface TreeDetailsRow {
  garden_object_id: string;
  canopy_geometry: string | null;
  common_name: string | null;
  estimated_height_metres: number | null;
  estimated_spread_metres: number | null;
}

export interface PlantPlacementDetailsRow {
  garden_object_id: string;
  common_name: string;
  quantity: Generated<number>;
  spacing_metres: number | null;
  assigned_to_object_id: string | null;
}

export interface UtilityExclusionDetailsRow {
  garden_object_id: string;
  utility_exclusion_kind: string;
  notes: string | null;
}

export interface AnnotationDetailsRow {
  garden_object_id: string;
  measurement_value: number | null;
  measurement_unit: string | null;
  acquisition_method: string | null;
  original_entry: string | null;
  uncertainty: number | null;
  reference_object_id: string | null;
  calibration_revision: number | null;
}

/**
 * `calibration_state` is `Generated<string>` for the same reason
 * `CoordinateSpaceRow.kind` is: the migration's CHECK constrains it (to
 * `'uncalibrated' | 'calibrated'` since P6-PLAN-02), and Kysely row types
 * describe what a column returns, not the CHECK's vocabulary. The current
 * transform itself is NOT stored here — the latest
 * `gardens_mapping.calibration` revision is the single source the read
 * path joins (see `imported-background-details.ts`).
 */
export interface ImportedBackgroundDetailsRow {
  garden_object_id: string;
  plan_media_id: string;
  source_page_number: number | null;
  is_background_visible: Generated<boolean>;
  calibration_state: Generated<string>;
}

/**
 * Append-only journal: `sequence` is the physical insertion order, `revision`
 * is the object's own logical revision at the time this row was written.
 * `geometry` is nullable because not every command changes geometry (a label
 * rename does not), matching the column's own nullability in the migration.
 */
export interface GardenObjectRevisionRow {
  sequence: Generated<number>;
  garden_object_id: string;
  revision: number;
  command_type: string;
  geometry: string | null;
  label: string | null;
  lifecycle_state: string;
  actor_profile_id: string;
  recorded_at: Generated<Date>;
}

/**
 * P6-PLAN-02 extended this row with the calibration INPUTS (`known_distance`,
 * `page_aspect_ratio`, `manual_adjustment`) and the DERIVED similarity
 * transform plus residuals. Every nullable-here column is nullable only for
 * legacy P3-shaped rows; rows written by the reworked `upsertCalibration`
 * command always carry them (the migration's `calibration_transform_atomic_check`).
 */
export interface CalibrationRow {
  id: string;
  background_object_id: string;
  revision: Generated<number>;
  reference_points: JsonValue;
  // No `| null` on the jsonb columns: JsonValue is `unknown`, which
  // already subsumes null (see platform-schema.ts).
  known_distance: JsonValue;
  page_aspect_ratio: number | null;
  manual_adjustment: JsonValue;
  metres_per_plan_unit: number | null;
  rotation_radians: number | null;
  translation_x_metres: number | null;
  translation_y_metres: number | null;
  point_residuals_metres: JsonValue;
  residual_error_metres: number | null;
  created_by_profile_id: string;
  created_at: Generated<Date>;
}

export interface GardensMappingDatabaseSchema {
  'gardens_mapping.garden': GardenRow;
  'collaboration.membership': MembershipRow;
  'gardens_mapping.coordinate_space': CoordinateSpaceRow;
  'gardens_mapping.georeference': GeoreferenceRow;
  'gardens_mapping.garden_object': GardenObjectRow;
  'gardens_mapping.structure_details': StructureDetailsRow;
  'gardens_mapping.fence_details': FenceDetailsRow;
  'gardens_mapping.gate_details': GateDetailsRow;
  'gardens_mapping.zone_details': ZoneDetailsRow;
  'gardens_mapping.bed_details': BedDetailsRow;
  'gardens_mapping.tree_details': TreeDetailsRow;
  'gardens_mapping.plant_placement_details': PlantPlacementDetailsRow;
  'gardens_mapping.utility_exclusion_details': UtilityExclusionDetailsRow;
  'gardens_mapping.annotation_details': AnnotationDetailsRow;
  'gardens_mapping.imported_background_details': ImportedBackgroundDetailsRow;
  'gardens_mapping.garden_object_revision': GardenObjectRevisionRow;
  'gardens_mapping.calibration': CalibrationRow;
}
