-- GBIF occurrence search originally cached the provider's arbitrary newest
-- worldwide results. Those rows have no stored broad geography and must not
-- remain eligible after the adapter starts requesting confirmed US field
-- observations. Marking, rather than deleting, preserves the provider audit
-- trail and makes the migration reversible.

-- Up Migration

SET ROLE verdery_migration;

UPDATE integrations.plant_media_asset
SET ingestion_state = 'rejected',
    generalized_location = 'legacy-unscoped'
WHERE provider_key = 'gbif'
  AND ingestion_state = 'discovered'
  AND generalized_location IS NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

UPDATE integrations.plant_media_asset
SET ingestion_state = 'discovered',
    generalized_location = NULL
WHERE provider_key = 'gbif'
  AND ingestion_state = 'rejected'
  AND generalized_location = 'legacy-unscoped';

RESET ROLE;
