import type { Generated } from 'kysely';

/**
 * `observation` has no `revision` column — see the migration's own doc
 * comment and `domain/observation.ts` for why. `observed_at`/`recorded_at`
 * are DB-defaulted (`now()`), but every constructor in this module always
 * supplies them explicitly, the same way `Garden.revision`
 * is always supplied despite being `Generated`.
 */
export interface ObservationRow {
  id: string;
  garden_id: string;
  plant_id: string | null;
  garden_object_id: string | null;
  actor_type: Generated<string>;
  created_by_profile_id: string | null;
  note_text: string | null;
  condition_summary: string | null;
  correction_kind: string | null;
  corrects_observation_id: string | null;
  observed_at: Generated<Date>;
  recorded_at: Generated<Date>;
}

export interface ObservationPhotoRow {
  id: string;
  observation_id: string;
  media_id: string;
  created_at: Generated<Date>;
}

/**
 * `confidence_score` is `numeric(4,3)` in the migration, which node-postgres
 * returns as a string by default — the same reasoning
 * `platform/database/pg-bigint-parser.ts` documents for `bigint` (OID 20).
 * No global type parser is registered for `numeric` (OID 1700) here: unlike
 * `bigint`, which is used across several modules' revision columns, `numeric`
 * columns are this module's own concern this pass, so the honest, narrowly-
 * scoped fix is a local row type plus explicit conversion in
 * `kysely-image-analysis-result-repository.ts`, not a second process-wide
 * type-parser registration alongside the bigint one.
 */
export interface ImageAnalysisResultRow {
  id: string;
  observation_photo_id: string;
  analysis_kind: string;
  suggested_label: string;
  confidence_score: string;
  requires_confirmation: Generated<boolean>;
  requested_additional_evidence: Generated<boolean>;
  created_at: Generated<Date>;
}

/**
 * Minimal read-only projection of `plants_inventory.plant`, a table owned
 * and fully declared by the plants-inventory module. Declared again here
 * with only the two columns this module ever reads — see
 * `application/plant-ownership-repository.ts` for why reading, never
 * writing, another module's table this narrowly is acceptable, and why no
 * type conflict is expected against that module's own, fuller declaration of
 * the same table key (Kysely's `DatabaseSchema` is the intersection of every
 * module's row types; two interfaces declaring the same field with the same
 * primitive type merge without conflict).
 */
export interface PlantOwnershipRow {
  id: string;
  garden_id: string;
}

export interface ObservationsHistoryDatabaseSchema {
  'observations_history.observation': ObservationRow;
  'observations_history.observation_photo': ObservationPhotoRow;
  'observations_history.image_analysis_result': ImageAnalysisResultRow;
  'plants_inventory.plant': PlantOwnershipRow;
}
