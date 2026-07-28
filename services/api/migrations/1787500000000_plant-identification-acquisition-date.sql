-- Extends the pending photo-identification suggestion (ADR-0015) with one
-- more AI-suggested field: an approximate acquisition date, alongside the
-- variety/stage/condition/care fields added in
-- 1787400000000_plant-identification-variety-stage-condition.sql. Same
-- pending-proposal shape as every other suggested field here —
-- `ConfirmPlantIdentification` only fills `plant.acquisitionDate` when it is
-- still null, never overwriting a value the owner already set (see
-- `domain/plant.ts`'s own `confirmPlantIdentification`).
--
-- A `date`, matching `plant.acquisition_date`'s own column type exactly —
-- the AI is estimating a calendar date from visible maturity, not a precise
-- timestamp.
--
-- Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_identification
  ADD COLUMN suggested_acquisition_date date;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_identification
  DROP COLUMN IF EXISTS suggested_acquisition_date;

RESET ROLE;
