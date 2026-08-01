-- Review-queue index (P11-PROV-01): `PlantFactAssertionRepository
-- .findAllAwaitingReview` / `PlantDistributionAssertionRepository
-- .findAllAwaitingReview` both filter on `review_status =
-- 'awaiting_horticultural_review'` ordered by `created_at ASC` — the new
-- reviewer-queue read `plant-taxon-knowledge-profile.sql`'s own header
-- named as a tracked, deliberate deferral ("no reviewer-facing surface
-- exists yet"). Neither table carried an index on `review_status` before
-- this: `plant_fact_assertion_provider_taxon_idx` covers a different access
-- pattern (provider_key, provider_taxon_id, fact_key). A partial index,
-- scoped to the one status value this query ever filters on, keeps the
-- index small as reviewed rows accumulate — the `plant_taxonomy_mapping
-- _live_identity_idx` partial-index precedent, applied here to a query
-- filter instead of a uniqueness constraint.
--
-- Source: services/api/src/modules/integrations/application/plant-fact-
--         assertion-repository.ts, `findAllAwaitingReview`.

-- Up Migration

SET ROLE verdery_migration;

CREATE INDEX plant_fact_assertion_awaiting_review_idx
  ON integrations.plant_fact_assertion (created_at)
  WHERE review_status = 'awaiting_horticultural_review';

CREATE INDEX plant_distribution_assertion_awaiting_review_idx
  ON integrations.plant_distribution_assertion (created_at)
  WHERE review_status = 'awaiting_horticultural_review';

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS integrations.plant_distribution_assertion_awaiting_review_idx;
DROP INDEX IF EXISTS integrations.plant_fact_assertion_awaiting_review_idx;

RESET ROLE;
