-- Preserve the complete identity and processing lineage of accepted
-- extraction proposals. Provenance and confidence remain indexed scalar
-- fields; source_metadata carries provider/model/transform attribution.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.garden_object
  ADD COLUMN source_metadata jsonb;

ALTER TABLE gardens_mapping.garden_object
  ADD CONSTRAINT garden_object_source_metadata_shape_check CHECK (
    source_metadata IS NULL OR jsonb_typeof(source_metadata) = 'object'
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.garden_object
  DROP CONSTRAINT IF EXISTS garden_object_source_metadata_shape_check;

ALTER TABLE gardens_mapping.garden_object
  DROP COLUMN IF EXISTS source_metadata;

RESET ROLE;
