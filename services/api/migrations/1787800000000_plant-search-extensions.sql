-- Plant search extensions: trigram indexes backing P11-SEARCH-01's two
-- newly-real search surfaces.
--
-- `plant_candidate.display_name`: candidates gain the same relevance-ranked
-- text search `plants_inventory.plant.display_name` already has
-- (`1784950000000_search-indexes.sql`) — `ListCandidates` was status-only
-- until this stage, by explicit deferral (`plant-candidate-repository.ts`'s
-- own header: "Full-text/relevance search over candidates is P11-SEARCH-01's
-- job").
--
-- `taxonomy_name.name_text`: the trigram index `1787700000000_plant-taxon-
-- knowledge-profile.sql`'s own header on `taxonomy_name_taxonomy_reference_id_idx`
-- explicitly forward-points at this stage: "with pg_trgm, added ... when
-- P11-SEARCH-01 builds the query, fuzzy matching against name_text across
-- kinds." `SearchTaxonomyReferences` matched only `taxonomy_reference.
-- scientific_name`/`.common_name` before this migration; synonyms, cultivar
-- names, and localized common names (`taxonomy_name`, added but unread by
-- P11-DATA-02) were structurally unreachable by search until now.
--
-- `pg_trgm` is already installed (`1784950000000_search-indexes.sql`) — no
-- `CREATE EXTENSION` needed here.
--
-- Source: implementation-plan.md work package P11-SEARCH-01.

-- Up Migration

SET ROLE verdery_migration;

CREATE INDEX plant_candidate_display_name_trgm_idx
  ON plants_inventory.plant_candidate USING GIN (display_name gin_trgm_ops);

CREATE INDEX taxonomy_name_name_text_trgm_idx
  ON plants_inventory.taxonomy_name USING GIN (name_text gin_trgm_ops);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS plants_inventory.taxonomy_name_name_text_trgm_idx;
DROP INDEX IF EXISTS plants_inventory.plant_candidate_display_name_trgm_idx;

RESET ROLE;
