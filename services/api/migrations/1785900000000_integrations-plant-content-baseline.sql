-- Integrations plant-content baseline: the `integrations` module's plant-content
-- half — provider-taxonomy identity mappings onto the application's own stable
-- taxonomy, and normalized licensed plant-content records — the storage side of
-- P7-INT-02 ("normalized plant-content adapter with stable application
-- taxonomy, source/version/license metadata, and user-fact separation").
--
-- This is provider-AGNOSTIC machinery only, the exact P7-INT-01 posture: no
-- real plant-content vendor exists anywhere in this repository — provider
-- selection is P0-PROV-01, an undecided implementation-time selection
-- (technical-specification.md, section "14.2 Implementation-Time Selections").
-- Nothing below names, assumes, or fabricates a vendor: `provider_key` is the
-- application-owned registry key of whichever adapter produced a row, and with
-- zero providers configured (today's reality) no row is ever produced — the
-- application surfaces typed no-provider outcomes instead
-- (`modules/integrations/application/refresh-plant-content.ts`).
--
-- The separation external-integrations.md section 8 requires, made physical:
--
--   "Stable application taxonomy identifiers" -> plants_inventory
--                                                .taxonomy_reference (P4),
--                                                referenced, never duplicated
--   "Provider taxonomy identifiers"           -> plant_taxonomy_mapping,
--                                                plant_content_record
--                                                .provider_taxon_id
--   "User garden facts"                       -> plants_inventory.plant,
--                                                which NOTHING here references
--                                                or writes — see below
--   "Licensed descriptions and images"        -> plant_content_record
--                                                (text content this slice;
--                                                images need the media
--                                                pipeline — a documented
--                                                deferral, not modeled empty)
--
-- User-fact separation is structural, not conventional: no table in this
-- migration references `plants_inventory.plant` (or any garden-scoped row),
-- and the only link into application data is the mapping's foreign key onto
-- the shared `taxonomy_reference` catalog — an identity catalog, not user
-- garden facts. External content can therefore never overwrite, shadow, or
-- masquerade as anything a user declared; a read that surfaces both sides
-- must join through the mapping and carries provider provenance on every
-- external row ("User edits do not overwrite provider source records").
--
-- Re-identification protection: `plant_content_record` deliberately carries
-- NO application-taxonomy column. Content is anchored to the PROVIDER's own
-- taxon identity; which application taxonomy it speaks about is resolved at
-- read time through the live (non-rejected) mapping row. A provider
-- reorganization can therefore never silently re-identify stored content or
-- the application's plants: changing what a provider taxon means to this
-- application requires explicitly rejecting the old mapping row and creating
-- a new one — both durable, auditable facts ("Provider selection changes
-- through configuration plus compatibility tests; it does not change domain
-- records silently", section 4).
--
-- Backfill posture: both tables are new; no existing row is touched.
--
-- Source: implementation-plan.md work package P7-INT-02;
--         architecture/external-integrations.md, sections "2. Integration
--         Boundary", "3. Adapter Contract", "4. Provider Registry",
--         "8. Plant Content", "14. Cost and Quota";
--         architecture/data-and-geospatial-design.md, section "20. External
--         Reference Data".

-- Up Migration

-- The `integrations` schema already exists (1785700000000) with default
-- privileges wired for `verdery_application`, so plain table creation under
-- SET ROLE inherits the module's established posture: row access for the
-- application, nothing for `verdery_worker` (no worker touches plant
-- content; the stage that gives one a job names what it needs).
SET ROLE verdery_migration;

-- Maps ONE provider's taxonomy identifier onto ONE stable application
-- taxonomy identity (`plants_inventory.taxonomy_reference`, the catalog P4
-- built and `AddPlant` resolves against). The application identity is the
-- anchor; provider identities map INTO it, never the reverse — replacing or
-- reorganizing a provider must never re-key the application's own taxonomy
-- ("Replacing a provider does not require migrating accepted garden
-- meaning", section 16).
--
-- Identity columns (`taxonomy_reference_id`, `provider_key`,
-- `provider_taxon_id`) are immutable after insert: correcting a wrong
-- mapping means rejecting this row and inserting a new one, not editing in
-- place — the `taxonomy_reference` supersede-not-edit posture, applied to
-- the link itself. Only `verification_state` may move, along the one-way
-- lifecycle unverified -> verified -> rejected (verification is a future
-- human action; every machine-created row starts 'unverified' and says so).
--
-- `provider_scientific_name` snapshots what the provider CALLED the taxon
-- when the mapping was made, so a later provider-side rename is detectable
-- as drift instead of silently absorbed. `confidence` is the provider's own
-- match confidence where supplied — never invented, null when the provider
-- reported none ("Missing facts remain missing").
CREATE TABLE integrations.plant_taxonomy_mapping (
  id uuid PRIMARY KEY,
  taxonomy_reference_id uuid NOT NULL REFERENCES plants_inventory.taxonomy_reference (id),
  provider_key text NOT NULL,
  provider_taxon_id text NOT NULL,
  provider_scientific_name text,
  confidence double precision,
  verification_state text NOT NULL DEFAULT 'unverified',
  state_note text,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_taxonomy_mapping_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT plant_taxonomy_mapping_provider_taxon_id_check CHECK (provider_taxon_id <> ''),
  CONSTRAINT plant_taxonomy_mapping_scientific_name_check CHECK (
    provider_scientific_name IS NULL OR provider_scientific_name <> ''
  ),
  CONSTRAINT plant_taxonomy_mapping_confidence_check CHECK (
    confidence IS NULL OR confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT plant_taxonomy_mapping_verification_state_check CHECK (
    verification_state IN ('unverified', 'verified', 'rejected')
  ),
  CONSTRAINT plant_taxonomy_mapping_state_note_check CHECK (
    state_note IS NULL OR state_note <> ''
  )
);

-- At most one LIVE (non-rejected) mapping per provider per application
-- taxonomy identity: the row content refresh resolves through. Rejected rows
-- stay behind as auditable history and do not block a corrected replacement.
-- Several application references MAY map to the same provider taxon (the
-- catalog allows user-defined duplicates of system entries), so no mirror
-- uniqueness exists on (provider_key, provider_taxon_id).
CREATE UNIQUE INDEX plant_taxonomy_mapping_live_identity_idx
  ON integrations.plant_taxonomy_mapping (provider_key, taxonomy_reference_id)
  WHERE verification_state <> 'rejected';

-- Normalized licensed plant-content records — data-and-geospatial-design.md
-- section 20's field list, one column set per bullet:
--
--   "Provider and provider record ID"   -> provider_key, provider_record_id
--   "Fetch and effective time"          -> fetched_at + provider_content_version
--                                          (content has no observation moment;
--                                          the provider's own version marker is
--                                          its effective identity — section 8's
--                                          "version/fetch time")
--   "License and attribution metadata"  -> license_note, attribution_text,
--                                          jurisdiction, presentation_note
--                                          (section 8's "jurisdiction, and
--                                          allowed presentation behavior")
--   "Raw payload reference only when
--    retention is permitted"            -> no column: no provider terms exist
--                                          to permit retention, so nothing is
--                                          retained (nothing honest to model)
--   "Normalized application fields"     -> content_language, description,
--                                          care_guidance
--
-- The two content sections are deliberately the whole normalized vocabulary:
-- a per-care-category structure would need the care-category glossary that
-- P0-PROD-03 has not decided (the same reason
-- `tasks_recommendations.recommendation_candidate.care_category` carries no
-- enum CHECK yet). Both are nullable — a provider may supply either — but a
-- row with neither records nothing and is not a content record.
--
-- Append-only and immutable: every successful provider fetch appends one row
-- (a fetch result is a historical fact — the `weather_record` posture), so
-- the latest row per provider taxon is the current content and earlier rows
-- are the version history section 8's "version/fetch time" implies. No
-- UPDATE path exists; user edits happen in user tables and can never touch
-- these rows ("User edits do not overwrite provider source records").
CREATE TABLE integrations.plant_content_record (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL,
  provider_taxon_id text NOT NULL,
  provider_record_id text,
  provider_content_version text,
  content_language text NOT NULL,
  description text,
  care_guidance text,
  fetched_at timestamptz NOT NULL,
  license_note text NOT NULL,
  attribution_text text,
  jurisdiction text,
  presentation_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_content_record_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT plant_content_record_provider_taxon_id_check CHECK (provider_taxon_id <> ''),
  CONSTRAINT plant_content_record_provider_record_id_check CHECK (
    provider_record_id IS NULL OR provider_record_id <> ''
  ),
  CONSTRAINT plant_content_record_content_version_check CHECK (
    provider_content_version IS NULL OR provider_content_version <> ''
  ),
  CONSTRAINT plant_content_record_content_language_check CHECK (content_language <> ''),
  CONSTRAINT plant_content_record_description_check CHECK (
    description IS NULL OR description <> ''
  ),
  CONSTRAINT plant_content_record_care_guidance_check CHECK (
    care_guidance IS NULL OR care_guidance <> ''
  ),
  CONSTRAINT plant_content_record_section_present_check CHECK (
    description IS NOT NULL OR care_guidance IS NOT NULL
  ),
  CONSTRAINT plant_content_record_license_note_check CHECK (license_note <> ''),
  CONSTRAINT plant_content_record_attribution_check CHECK (
    attribution_text IS NULL OR attribution_text <> ''
  ),
  CONSTRAINT plant_content_record_jurisdiction_check CHECK (
    jurisdiction IS NULL OR jurisdiction <> ''
  ),
  CONSTRAINT plant_content_record_presentation_note_check CHECK (presentation_note <> '')
);

-- Serves this stage's own read: "the latest content this provider fetched
-- for this provider taxon" — the refetch-window cache decision and the
-- `GetPlantContent` read are both `(provider_key, provider_taxon_id,
-- fetched_at DESC) LIMIT 1`. A future content UI adds what its own queries
-- need; not guessed here.
CREATE INDEX plant_content_record_provider_taxon_fetched_idx
  ON integrations.plant_content_record (provider_key, provider_taxon_id, fetched_at DESC);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS integrations.plant_content_record CASCADE;
DROP TABLE IF EXISTS integrations.plant_taxonomy_mapping CASCADE;

RESET ROLE;
