-- Plant-candidate photo attachment: `AddCandidateFromPhoto` creates exactly
-- one of these per candidate it identifies (a candidate never gains a
-- second photo through any command this pass adds — `AttachPlantPhoto`'s
-- own multi-photo/primary-flag machinery has no candidate equivalent yet,
-- a deliberate, narrower scope than `plants_inventory.plant_photo`).
-- `is_primary` is still carried, defaulted true, so a later pass that DOES
-- add multi-photo support to candidates needs no new column, mirroring
-- `plant_photo`'s own shape exactly for that reason.
--
-- Referenced from two places outside this module, the same way
-- `plant_photo` already is: `deletion.purge-plan.ts` (a candidate's photo
-- rows must clear before the candidate itself), and
-- `media.MediaReferenceFinder` (`'candidate_photo'` joins `'plant_photo'`/
-- `'observation_photo'`/`'task_attachment'`/`'imported_background'` in the
-- reference-kind vocabulary `DeleteGardenMedia`'s `409 media.referenced`
-- guard checks before a media record may be deleted).
--
-- Source: implementation-plan.md work package P11-WEB-01 (candidate photo
-- identification, added on user request); architecture/plant-intelligence-
-- and-visual-journal.md, section "3.3 Candidate".

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE plants_inventory.plant_candidate_photo (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES plants_inventory.plant_candidate (id),
  media_id uuid NOT NULL REFERENCES media.media_record (id),
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plant_candidate_photo_candidate_id_idx
  ON plants_inventory.plant_candidate_photo (candidate_id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS plants_inventory.plant_candidate_photo CASCADE;

RESET ROLE;
