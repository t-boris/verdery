-- One row per provider image, so re-running enrichment refreshes what a
-- source claims instead of accumulating copies of one photograph.
--
-- `plant_media_asset` was created with a non-unique lookup index only, which
-- is correct for reading a taxon's assets and silent about writing them: a
-- second enrichment pass over the same taxon would insert every image again.
-- Nothing had written to the table yet, so no duplicates exist to clean up.
--
-- The key is `(provider_key, source_url)`. GBIF's media entries carry no
-- identifier of their own — verified against the live API — so the image URL
-- is the only stable per-asset identity a provider actually supplies, and it
-- is scoped by provider because two sources may legitimately serve the same
-- URL.
--
-- PARTIAL, because `source_url` is nullable by design: an asset already
-- ingested into this application's own storage is identified by `media_id`
-- and may legitimately have no external URL. Those rows are outside this
-- constraint rather than colliding on a shared NULL.
--
-- Source: implementation-plan.md work package P11-DATA-02; architecture/
-- plant-intelligence-and-visual-journal.md, section 7.

-- Up Migration

SET ROLE verdery_migration;

CREATE UNIQUE INDEX plant_media_asset_provider_source_unique
  ON integrations.plant_media_asset (provider_key, source_url)
  WHERE source_url IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS integrations.plant_media_asset_provider_source_unique;

RESET ROLE;
