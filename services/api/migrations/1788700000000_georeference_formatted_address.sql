-- Retain the exact address candidate a person accepted when georeferencing
-- by address. Coordinates remain the spatial authority; this text is the
-- human-readable identity needed to show and revisit that choice.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.georeference
  ADD COLUMN formatted_address text;

ALTER TABLE gardens_mapping.georeference
  ADD CONSTRAINT georeference_formatted_address_length_check CHECK (
    formatted_address IS NULL OR char_length(formatted_address) BETWEEN 1 AND 500
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.georeference
  DROP CONSTRAINT IF EXISTS georeference_formatted_address_length_check;

ALTER TABLE gardens_mapping.georeference
  DROP COLUMN IF EXISTS formatted_address;

RESET ROLE;
