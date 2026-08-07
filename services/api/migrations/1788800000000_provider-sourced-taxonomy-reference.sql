-- Provider-sourced taxonomy references.
--
-- A confident photo-identification result includes a scientific name, but a
-- deployment may have no pre-seeded taxonomy catalog row for that species.
-- Keeping only the common name leaves the candidate permanently
-- "Not identified" and prevents every taxonomy-backed workflow. This source
-- value records an honest, unreviewed stable reference instead. Real plants
-- still require the existing identification-confirmation command before the
-- reference is attached to their aggregate.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.taxonomy_reference
  DROP CONSTRAINT taxonomy_reference_source_check;

ALTER TABLE plants_inventory.taxonomy_reference
  ADD CONSTRAINT taxonomy_reference_source_check
  CHECK (source IN ('system_catalog', 'user_defined', 'provider_sourced'));

CREATE UNIQUE INDEX taxonomy_reference_provider_scientific_name_idx
  ON plants_inventory.taxonomy_reference (lower(scientific_name))
  WHERE source = 'provider_sourced';

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS plants_inventory.taxonomy_reference_provider_scientific_name_idx;

ALTER TABLE plants_inventory.taxonomy_reference
  DROP CONSTRAINT taxonomy_reference_source_check;

ALTER TABLE plants_inventory.taxonomy_reference
  ADD CONSTRAINT taxonomy_reference_source_check
  CHECK (source IN ('system_catalog', 'user_defined')) NOT VALID;

RESET ROLE;
