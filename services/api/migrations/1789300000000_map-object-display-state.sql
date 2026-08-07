-- Persist visibility and edit-lock state on each map object. These are
-- object-level controls, independent from the client-local layer controls.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.garden_object
  ADD COLUMN is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN is_locked boolean NOT NULL DEFAULT false;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.garden_object
  DROP COLUMN is_locked,
  DROP COLUMN is_hidden;

RESET ROLE;
