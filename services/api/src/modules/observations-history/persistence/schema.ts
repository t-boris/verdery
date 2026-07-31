import type { Generated } from 'kysely';

/**
 * `observation` has no `revision` column — see the migration's own doc
 * comment and `domain/observation.ts` for why. `observed_at`/`recorded_at`
 * are DB-defaulted (`now()`), but every constructor in this module always
 * supplies them explicitly, the same way `Garden.revision`
 * is always supplied despite being `Generated`.
 *
 * `observed_phenological_stage`/`observed_sun_exposure`/`observed_drainage`/
 * `observed_growing_context` (P11-MEDIA-01) — see
 * migrations/1787900000000_visual-journal-observation-extensions.sql.
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
  observed_phenological_stage: string | null;
  observed_sun_exposure: string | null;
  observed_drainage: string | null;
  observed_growing_context: string | null;
  observed_at: Generated<Date>;
  recorded_at: Generated<Date>;
}

/** `purpose` (P11-MEDIA-01) is nullable at the schema level for rows recorded before this capability existed — see `domain/observation-photo.ts`. */
export interface ObservationPhotoRow {
  id: string;
  observation_id: string;
  media_id: string;
  purpose: string | null;
  created_at: Generated<Date>;
}

/**
 * `value` is `numeric(10,2)`, returned as a string by node-postgres — the
 * same `numeric` handling `ImageAnalysisResultRow.confidence_score` already
 * documents below.
 */
export interface ObservationMeasurementRow {
  id: string;
  observation_id: string;
  kind: string;
  value: string;
  unit: string;
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
 *
 * `alternative_explanations`/`requested_view_purposes` are `jsonb` string
 * arrays (P11-HEALTH-01), returned already-parsed by node-postgres — typed
 * `unknown` here, the same posture
 * `tasks_recommendations.persistence.schema.ts`'s `packet_fact_keys` row
 * field already takes, validated in the repository, not trusted blindly.
 */
export interface ImageAnalysisResultRow {
  id: string;
  observation_photo_id: string;
  analysis_kind: string;
  suggested_label: string;
  confidence_score: string;
  requires_confirmation: Generated<boolean>;
  requested_additional_evidence: Generated<boolean>;
  model_name: string | null;
  prompt_version: number | null;
  evidence_summary: Generated<string>;
  alternative_explanations: unknown;
  requested_view_purposes: unknown;
  safety_class: Generated<string>;
  disposition: Generated<string>;
  disposition_set_at: Date | null;
  disposition_set_by_profile_id: string | null;
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
  'observations_history.observation_measurement': ObservationMeasurementRow;
  'plants_inventory.plant': PlantOwnershipRow;
}
