-- Preserves the AI's own raw name guess on a `plant_identification` row when
-- it has no matching `taxonomy_reference` catalog entry, instead of the
-- historical behavior of discarding a confident answer entirely (the exact
-- same shape a genuinely unconfident/unavailable identification already
-- produced). See `application/identify-plant-from-photo.ts`'s own doc
-- comment for the full mutual-exclusivity invariant this pair maintains
-- with `suggested_taxonomy_id`: never both non-null — either the AI's name
-- matched the catalog (id set, these two null), or it didn't (id null,
-- these two carry the AI's own guess), or the AI was not confident/
-- available at all (everything null, unchanged from before this migration).
--
-- Both columns are nullable with no default and no backfill: this is an
-- append-only table, and every historical row correctly reads back as
-- `null` for both, matching what those rows already meant before this
-- capability existed.
--
-- Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_identification
  ADD COLUMN suggested_common_name text,
  ADD COLUMN suggested_scientific_name text;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_identification
  DROP COLUMN IF EXISTS suggested_common_name,
  DROP COLUMN IF EXISTS suggested_scientific_name;

RESET ROLE;
