-- Extends the pending photo-identification suggestion (ADR-0015) with four
-- more AI-suggested fields, alongside the name/taxonomy suggestion added in
-- 1787300000000_plant-identification-raw-suggestion.sql: variety, growth
-- stage, condition, and care guidance. Like that migration's own pair, these
-- are pending proposals only — `ConfirmPlantIdentification` is what may
-- apply them to a `plant` row, and only ever fills in a field still at its
-- creation default, never overwriting a value the owner already edited by
-- hand (see `domain/plant.ts`'s own `confirmPlantIdentification`).
--
-- `suggested_lifecycle_stage`'s CHECK mirrors `plant_lifecycle_stage_check`'s
-- own enum exactly, so this column only ever holds a real `LifecycleStage`
-- value — the AI's own response schema separately excludes `'planned'` from
-- what it may ever say (a photographed plant is never in the pre-planting
-- "planned" stage), but that is an application-level constraint on the
-- model's answer, not a column-level one.
--
-- Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_identification
  ADD COLUMN suggested_variety_label text,
  ADD COLUMN suggested_lifecycle_stage text,
  ADD COLUMN suggested_condition_note text,
  ADD COLUMN suggested_care_guidance_note text,
  ADD CONSTRAINT plant_identification_suggested_lifecycle_stage_check CHECK (
    suggested_lifecycle_stage IS NULL OR suggested_lifecycle_stage IN (
      'planned', 'seed', 'seedling', 'transplanted', 'growing', 'flowering',
      'fruiting', 'ready_to_harvest'
    )
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_identification
  DROP CONSTRAINT IF EXISTS plant_identification_suggested_lifecycle_stage_check,
  DROP COLUMN IF EXISTS suggested_variety_label,
  DROP COLUMN IF EXISTS suggested_lifecycle_stage,
  DROP COLUMN IF EXISTS suggested_condition_note,
  DROP COLUMN IF EXISTS suggested_care_guidance_note;

RESET ROLE;
