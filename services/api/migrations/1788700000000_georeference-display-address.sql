-- Keep the human-readable address a person confirmed alongside the
-- georeference revision it describes. The coordinate remains the geometric
-- authority; this value is only the recognizable label shown in the UI.
--
-- Nullable for existing records and for device/manual locations that have no
-- confirmed address. The length constraint matches the geocoding contract.
--
-- Source: architecture/data-and-geospatial-design.md, section 9.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.georeference
  ADD COLUMN display_address text,
  ADD CONSTRAINT georeference_display_address_length_check CHECK (
    display_address IS NULL OR char_length(display_address) BETWEEN 1 AND 200
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.georeference
  DROP CONSTRAINT IF EXISTS georeference_display_address_length_check,
  DROP COLUMN IF EXISTS display_address;

RESET ROLE;
