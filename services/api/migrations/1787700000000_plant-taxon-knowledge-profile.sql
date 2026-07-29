-- Plant taxon knowledge profile (P11-DATA-02, Phase 11 — see ADR-0016 for
-- the full concept-to-table mapping this migration implements).
--
-- Extends the P7-INT-02 provider-agnostic machinery
-- (`integrations.plant_taxonomy_mapping`, `integrations.plant_content_record`)
-- rather than forking it: those two tables already ARE the design doc's
-- "plant_taxon_external_identifier" and "plant_source_record" (text half).
-- This migration adds the STRUCTURED counterpart of `plant_content_record`
-- (typed facts and geographic distribution, not prose), licensed media
-- metadata, a synonym/localized-name crosswalk for the stable application
-- taxon identity, and a materialized read projection.
--
-- `plant_fact_assertion`/`plant_distribution_assertion` reuse
-- `taxonomy_seasonal_fact`'s (P9D-SEASON-DATA-01) exact `authoring_method`/
-- `source_citation`/`review_status`/`reviewed_by`/`reviewed_on` provenance
-- shape and its two clean-equivalence CHECK pairs, generalized from seasonal
-- timing to any structured fact or distribution claim. ADR-0013's toxicity/
-- edibility exclusion is enforced STRUCTURALLY here too, the same way it is
-- for observation-photo condition analysis: `plant_fact_assertion_toxicity_
-- edibility_human_only_check` rejects any row whose `fact_key` is
-- `'toxicity'`/`'edibility'` unless `authoring_method = 'human_authored'` —
-- a model cannot author these facts even through the extraction path, only
-- through a human's own hand at the keyboard.
--
-- Both assertion tables anchor to `(provider_key, provider_taxon_id)`, NOT
-- `taxonomy_reference_id` directly — the identical re-identification
-- protection `plant_content_record`'s own header explains: which
-- application taxon a provider assertion speaks about is resolved at read
-- time through the live (non-rejected) `plant_taxonomy_mapping` row, so a
-- provider reorganization can never silently re-identify stored facts.
-- Human-authored rows (no provider involved) use the reserved
-- `provider_key = 'human'` sentinel with `provider_taxon_id` set to the
-- taxon's own `taxonomy_reference_id` cast to text — there is no live
-- mapping to resolve through for content this project authored itself, so
-- the identity has to be direct; `plant_fact_assertion_human_authored_
-- identity_check` enforces the pairing.
--
-- `plant_media_asset` models the media gap `plant_content_record`'s own
-- header named as "a documented deferral, not modeled empty": a licensed
-- image known to exist at a provider, tracked through discovery ->
-- ingestion (or license rejection) before it ever becomes a `media.
-- media_record` the rest of the application can reference. `organ` uses the
-- design doc's own thirteen-category vocabulary (section 7); `inferred_organ`
-- is `taxonomy_seasonal_fact.review_status`'s "honest until reviewed"
-- posture applied to a model-inferred classification instead of authored
-- content. `license` stores every value the design doc's allowlist
-- (section 7) discusses, including the excluded ones (`cc_by_nc`, `unknown`,
-- `withdrawn`) — presentation ELIGIBILITY is an application-layer decision
-- that can evolve without a migration each time a license category's
-- standing changes; the column only records what the source actually
-- claims.
--
-- `taxonomy_name` is new: `taxonomy_reference` carries exactly one
-- `common_name` column today, which cannot represent synonyms, cultivar
-- names, or more than one locale — all of which design doc section 12
-- ("Search covers accepted scientific names, synonyms, localized common
-- names, cultivar names") requires. One row per name; `taxonomy_reference`
-- itself is untouched.
--
-- `plant_profile_version` is the materialized, source-priority-resolved
-- display projection design doc section 4 describes — append-only, like
-- `plant_content_record`: a rebuild produces a new row, never an edit to a
-- past one, so "what did the profile say on date X" stays answerable.
-- `resolved` is `jsonb`; its internal shape is defined and validated by this
-- module's own application-layer assembly function
-- (`domain/plant-profile-version.ts`), not by this migration — the same
-- `media_processing_job.result_summary` posture `plant_candidate.
-- candidate_suitability_assessment.result` already established one
-- migration ago.
--
-- Source: implementation-plan.md work package P11-DATA-02;
--         architecture/plant-intelligence-and-visual-journal.md, sections
--         "3.1 Taxon Knowledge Profile", "4. Data Model", "7. Life Cycle and
--         Representative Media", "12. Search and Filters";
--         architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
--         architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE integrations.plant_fact_assertion (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL,
  provider_taxon_id text NOT NULL,
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  unit text,
  confidence double precision,
  -- NULL means globally applicable; non-null narrows to a region (e.g. a US
  -- state code or USDA hardiness zone context) the same way `plant_content_
  -- record.jurisdiction` narrows licensed text.
  geographic_scope text,
  authoring_method text NOT NULL,
  source_citation text,
  review_status text NOT NULL,
  reviewed_by text,
  reviewed_on date,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_fact_assertion_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT plant_fact_assertion_provider_taxon_id_check CHECK (provider_taxon_id <> ''),
  CONSTRAINT plant_fact_assertion_fact_key_check CHECK (fact_key <> ''),
  CONSTRAINT plant_fact_assertion_confidence_check CHECK (
    confidence IS NULL OR confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT plant_fact_assertion_authoring_method_check CHECK (
    authoring_method IN ('human_authored', 'ai_extracted_from_source', 'ai_proposed_reviewed')
  ),
  CONSTRAINT plant_fact_assertion_source_citation_linkage_check CHECK (
    (authoring_method = 'ai_extracted_from_source') = (source_citation IS NOT NULL)
  ),
  CONSTRAINT plant_fact_assertion_review_status_check CHECK (
    review_status IN ('awaiting_horticultural_review', 'horticulturally_reviewed')
  ),
  CONSTRAINT plant_fact_assertion_reviewed_linkage_check CHECK (
    (review_status = 'horticulturally_reviewed') = (reviewed_by IS NOT NULL)
  ),
  CONSTRAINT plant_fact_assertion_reviewed_on_linkage_check CHECK (
    (reviewed_by IS NULL) = (reviewed_on IS NULL)
  ),
  -- ADR-0013's structural exclusion: no path, including extraction, may
  -- author toxicity/edibility except a human's own hand.
  CONSTRAINT plant_fact_assertion_toxicity_edibility_human_only_check CHECK (
    fact_key NOT IN ('toxicity', 'edibility') OR authoring_method = 'human_authored'
  ),
  -- See this file's header: human-authored rows have no live provider
  -- mapping to resolve identity through, so they self-identify directly.
  CONSTRAINT plant_fact_assertion_human_authored_identity_check CHECK (
    authoring_method <> 'human_authored' OR provider_key = 'human'
  )
);

CREATE INDEX plant_fact_assertion_provider_taxon_idx
  ON integrations.plant_fact_assertion (provider_key, provider_taxon_id, fact_key);

CREATE TABLE integrations.plant_distribution_assertion (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL,
  provider_taxon_id text NOT NULL,
  region text NOT NULL,
  status text NOT NULL,
  confidence double precision,
  authoring_method text NOT NULL,
  source_citation text,
  review_status text NOT NULL,
  reviewed_by text,
  reviewed_on date,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_distribution_assertion_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT plant_distribution_assertion_provider_taxon_id_check CHECK (provider_taxon_id <> ''),
  CONSTRAINT plant_distribution_assertion_region_check CHECK (region <> ''),
  CONSTRAINT plant_distribution_assertion_status_check CHECK (
    status IN ('native', 'introduced', 'invasive', 'regulated')
  ),
  CONSTRAINT plant_distribution_assertion_confidence_check CHECK (
    confidence IS NULL OR confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT plant_distribution_assertion_authoring_method_check CHECK (
    authoring_method IN ('human_authored', 'ai_extracted_from_source', 'ai_proposed_reviewed')
  ),
  CONSTRAINT plant_distribution_assertion_source_citation_linkage_check CHECK (
    (authoring_method = 'ai_extracted_from_source') = (source_citation IS NOT NULL)
  ),
  CONSTRAINT plant_distribution_assertion_review_status_check CHECK (
    review_status IN ('awaiting_horticultural_review', 'horticulturally_reviewed')
  ),
  CONSTRAINT plant_distribution_assertion_reviewed_linkage_check CHECK (
    (review_status = 'horticulturally_reviewed') = (reviewed_by IS NOT NULL)
  ),
  CONSTRAINT plant_distribution_assertion_reviewed_on_linkage_check CHECK (
    (reviewed_by IS NULL) = (reviewed_on IS NULL)
  ),
  CONSTRAINT plant_distribution_assertion_human_authored_identity_check CHECK (
    authoring_method <> 'human_authored' OR provider_key = 'human'
  )
);

CREATE INDEX plant_distribution_assertion_provider_taxon_idx
  ON integrations.plant_distribution_assertion (provider_key, provider_taxon_id, region);

-- See this file's header for the discovery -> ingestion lifecycle and the
-- license-eligibility-is-application-layer reasoning.
CREATE TABLE integrations.plant_media_asset (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL,
  provider_taxon_id text NOT NULL,
  -- Set once ingested into the real media pipeline; null while only known
  -- by reference.
  media_id uuid REFERENCES media.media_record (id),
  source_url text,
  organ text,
  inferred_organ boolean NOT NULL DEFAULT false,
  license text NOT NULL,
  attribution_text text,
  creator text,
  rights_holder text,
  observed_at timestamptz,
  -- Generalized only (e.g. a region name), never precise coordinates —
  -- mirrors the observation-photo privacy posture design doc section 8.3
  -- describes for user-captured media, applied here to provider media.
  generalized_location text,
  ingestion_state text NOT NULL DEFAULT 'discovered',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_media_asset_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT plant_media_asset_provider_taxon_id_check CHECK (provider_taxon_id <> ''),
  CONSTRAINT plant_media_asset_source_check CHECK (media_id IS NOT NULL OR source_url IS NOT NULL),
  CONSTRAINT plant_media_asset_organ_check CHECK (
    organ IS NULL OR organ IN (
      'seed', 'seedling', 'juvenile', 'mature_habit', 'leaf', 'stem_or_bark', 'bud',
      'flowering', 'fruiting', 'seed_production', 'senescent', 'dormant', 'natural_habitat'
    )
  ),
  CONSTRAINT plant_media_asset_license_check CHECK (
    license IN ('public_domain', 'cc0', 'cc_by', 'cc_by_sa', 'cc_by_nc', 'unknown', 'withdrawn')
  ),
  CONSTRAINT plant_media_asset_ingestion_state_check CHECK (
    ingestion_state IN ('discovered', 'rejected', 'ingested')
  ),
  -- An ingested asset must actually reference the media it was ingested
  -- into; a merely-discovered or rejected one has none yet.
  CONSTRAINT plant_media_asset_ingestion_linkage_check CHECK (
    (ingestion_state = 'ingested') = (media_id IS NOT NULL)
  )
);

CREATE INDEX plant_media_asset_provider_taxon_idx
  ON integrations.plant_media_asset (provider_key, provider_taxon_id);

-- See this file's header: synonyms/localized/cultivar names `taxonomy_
-- reference`'s single `common_name` column cannot represent. No UPDATE
-- path: a wrong entry is superseded by a new row, the same posture
-- `taxonomy_reference` itself documents for its own no-UPDATE rule.
CREATE TABLE plants_inventory.taxonomy_name (
  id uuid PRIMARY KEY,
  taxonomy_reference_id uuid NOT NULL REFERENCES plants_inventory.taxonomy_reference (id),
  name_kind text NOT NULL,
  -- Null for scientific names/synonyms (locale-independent); required for
  -- common names.
  locale text,
  name_text text NOT NULL,
  source text NOT NULL,
  -- Set only when source = 'provider_sourced'.
  provider_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taxonomy_name_kind_check CHECK (
    name_kind IN ('accepted_scientific', 'synonym_scientific', 'common', 'cultivar')
  ),
  CONSTRAINT taxonomy_name_locale_linkage_check CHECK (
    (name_kind = 'common') = (locale IS NOT NULL)
  ),
  CONSTRAINT taxonomy_name_text_check CHECK (name_text <> ''),
  CONSTRAINT taxonomy_name_source_check CHECK (
    source IN ('system_catalog', 'user_defined', 'provider_sourced')
  ),
  CONSTRAINT taxonomy_name_provider_key_linkage_check CHECK (
    (source = 'provider_sourced') = (provider_key IS NOT NULL)
  )
);

-- Serves the search projection design doc section 12 requires: every name
-- form for a taxon, and (with `pg_trgm`, added by `search-indexes.test.ts`'s
-- own migration precedent when `P11-SEARCH-01` builds the query) fuzzy
-- matching against `name_text` across kinds.
CREATE INDEX taxonomy_name_taxonomy_reference_id_idx
  ON plants_inventory.taxonomy_name (taxonomy_reference_id);

-- The materialized, cited, source-priority-resolved profile — see this
-- file's header for why `resolved`'s shape is validated at the application
-- layer, not here. `resolved` is a jsonb ARRAY of resolved facts (the
-- application layer's `ResolvedFact[]`), so its non-empty check mirrors
-- `calibration_reference_points_not_empty_check`'s `jsonb_array_length`
-- form, not an empty-object comparison: a version with zero resolved facts
-- is not a version, by the same reasoning `RebuildPlantProfileVersion`
-- (application layer) skips persisting one at all when nothing has cleared
-- review yet — there is no "empty but recorded" state for this table.
CREATE TABLE plants_inventory.plant_profile_version (
  id uuid PRIMARY KEY,
  taxonomy_reference_id uuid NOT NULL REFERENCES plants_inventory.taxonomy_reference (id),
  resolved jsonb NOT NULL,
  is_partial boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_profile_version_resolved_not_empty_check CHECK (
    jsonb_array_length(resolved) > 0
  )
);

-- Serves "the latest profile version for this taxon" — the same
-- `(key, created_at DESC) LIMIT 1` shape every other append-only,
-- latest-wins table in this schema already uses.
CREATE INDEX plant_profile_version_taxonomy_reference_idx
  ON plants_inventory.plant_profile_version (taxonomy_reference_id, created_at DESC);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS plants_inventory.plant_profile_version CASCADE;
DROP TABLE IF EXISTS plants_inventory.taxonomy_name CASCADE;
DROP TABLE IF EXISTS integrations.plant_media_asset CASCADE;
DROP TABLE IF EXISTS integrations.plant_distribution_assertion CASCADE;
DROP TABLE IF EXISTS integrations.plant_fact_assertion CASCADE;

RESET ROLE;
