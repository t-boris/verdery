-- Structured latest-photo analysis for plant candidates.
--
-- This snapshot keeps every plant fact returned by the bounded species and
-- condition providers together. It is intentionally JSON rather than a note:
-- callers can render and later migrate each fact without parsing prose.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_candidate
  ADD COLUMN photo_analysis jsonb,
  ADD CONSTRAINT plant_candidate_photo_analysis_object_check
  CHECK (photo_analysis IS NULL OR jsonb_typeof(photo_analysis) = 'object');

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_candidate
  DROP CONSTRAINT IF EXISTS plant_candidate_photo_analysis_object_check,
  DROP COLUMN IF EXISTS photo_analysis;

RESET ROLE;
