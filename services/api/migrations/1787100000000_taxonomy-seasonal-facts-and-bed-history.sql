-- Season data foundation (P9D-SEASON-DATA-01, Stage 1 of P9D-SEASON-01):
-- botanical family/genus on the taxonomy catalog, per-hemisphere seasonal
-- timing facts, and a placement/taxon snapshot on the plant revision journal
-- so bed occupancy can be reconstructed after the fact.
--
-- RESEARCH FINDING THAT SHAPED THIS MIGRATION: `plants_inventory
-- .taxonomy_reference` has no application-layer write path at all today.
-- `plants-inventory/public.ts`'s own header says so directly ("Deliberately
-- absent this pass: a `CreateTaxonomyReference` command ... Tests seed rows
-- directly") and `domain/taxonomy-reference.ts`'s header confirms it
-- ("Read-only in this pass — no `CreateTaxonomyReference` command exists
-- yet"). Every row in this table today is either seeded independently of any
-- profile (`source = 'system_catalog'`) or inserted directly by a test
-- fixture; `CreatePlant`/`ConfirmPlantIdentification` only ever REFERENCE an
-- existing `taxonomy_reference_id`, never create one. Family/genus therefore
-- needs no new command of its own — these are purely additive nullable
-- columns, backfilled by seed/fixture data exactly like the table's existing
-- `common_name`/`variety_name`, which already take the identical
-- "unknown stays unknown" latitude.
--
-- Family/genus is deliberately NOT exposed on `taxonomy-reference-view.ts`'s
-- `TaxonomyReferenceResource` in this pass — this stage is schema/domain
-- only (tasks/todo.md, "Stage 1 — P9D-SEASON-DATA-01"); a consuming HTTP
-- surface is a later decision, not implied by adding the columns.
--
-- `plants_inventory.taxonomy_seasonal_fact`: one row per
-- (taxonomyReferenceId, hemisphere) — sowing/transplant/harvest windows
-- genuinely differ by hemisphere, so hemisphere is part of the natural key,
-- not a modifier column. Every timing/duration column is nullable: a root
-- vegetable with no transplant stage, or a crop with no known succession
-- benefit, must be representable without a fabricated window (never invent a
-- value a source does not support — ADR-0013's own extraction rule, applied
-- here to every column, not only the ones ADR-0013 names by name).
--
-- ADR-0013 COMPLIANCE, STRUCTURAL: `authoring_method` records HOW the row's
-- content came to exist (`human_authored`, `ai_extracted_from_source`,
-- `ai_proposed_reviewed` — ADR-0013's own three lawful paths).
-- `source_citation` is required exactly when `authoring_method =
-- 'ai_extracted_from_source'` — extraction records the licensed source text
-- it parsed; the other two methods have no source citation to carry
-- (`ai_proposed_reviewed` becomes the project's OWN authored content once
-- accepted, per ADR-0013's "Permitted: proposal into a human review queue").
-- `review_status`/`reviewed_by`/`reviewed_on` mirror `RuleReviewMetadata`
-- (tasks-recommendations/domain/rule-definition.ts) exactly, the same
-- honest-until-reviewed shape applied to DATA content instead of RULE
-- content: every launch rule ships `awaiting_horticultural_review` until a
-- named human reviewer signs off, and so does every seasonal fact here.
-- Stage 2's rules (a separate, later work package) must only ever read
-- `review_status = 'horticulturally_reviewed'` rows — the read port
-- enforces this filter itself (`taxonomy-seasonal-fact-repository.ts`), not
-- merely a documented expectation.
--
-- The three paired CHECKs below mirror
-- `garden_context_fact_source_reviewed_linkage_check`/
-- `garden_context_fact_reviewed_on_linkage_check`
-- (1787000000000_garden-context-facts.sql) exactly — the same
-- discriminant-is-itself-the-fact pairing style established there, applied
-- to two independent axes here (authoring method <-> source citation, and
-- review status <-> reviewer sign-off) instead of one.
--
-- NO `revision` COLUMN, NO UPDATE PATH: like `taxonomy_reference` itself
-- ("No UPDATE path: a wrong entry is superseded by a new row, not edited in
-- place" — 1784900000000_plants-observations-tasks-baseline.sql), this table
-- has no command that writes to it in this pass — rows are seed/fixture
-- content, immutable after insert, so there is nothing to guard with
-- optimistic concurrency and no `updated_at` that would ever change.
--
-- No separate `taxonomy_reference_id` index: `taxonomy_seasonal_fact_
-- taxonomy_hemisphere_key` already leads with `taxonomy_reference_id`, the
-- same judgment `garden_context_fact_garden_context_kind_key` already makes
-- for `garden_id` (see that migration's own comment).
--
-- BED-OCCUPANCY HISTORY VIA `plant_revision`, NOT A NEW TABLE: three
-- nullable snapshot columns — `garden_area_map_object_id`,
-- `placement_map_object_id`, `taxonomy_reference_id` — added to the
-- EXISTING journal, following its own established partial-snapshot
-- convention exactly (`lifecycle_stage`/`status` are already populated only
-- by the commands that change them; see that table's own comment above).
-- `createPlant` and `addPlantFromPhoto` populate all three (a plant's
-- placement and taxonomy are both established at creation, even when
-- taxonomy is explicitly null). `movePlant` populates only the two
-- placement columns. `confirmPlantIdentification` populates only
-- `taxonomy_reference_id`. `updateDetails` ALSO populates only
-- `taxonomy_reference_id`, but only on the specific call that actually
-- named `taxonomyReferenceId` in its input — checked directly against
-- `domain/plant.ts`'s `PlantDetailsChanges`/`updatePlantDetails`:
-- `taxonomyReferenceId` is one of the fields that command can change, not
-- only `ConfirmPlantIdentification`'s own domain function, so both commands
-- snapshot it when (and only when) they actually touch it.
-- `transitionLifecycleStage`/`setStatus` leave all three null, unchanged
-- from the columns' own default — neither touches placement or taxonomy. A
-- new read function
-- (`application/bed-occupancy-history.ts`) reconstructs "which taxon
-- occupied bed X during interval [t1, t2]" by finding, per plant, the
-- latest placement-bearing row at or before a given time (for location) and
-- the latest taxonomy-bearing row at or before that same point (for
-- identity) — deliberately not a second interval table that could drift
-- from this journal.
--
-- Source: tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 1 —
--         P9D-SEASON-DATA-01"; docs/architecture/decisions/ADR-0013-ai-
--         assisted-care-content-authoring.md.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.taxonomy_reference
  ADD COLUMN family text,
  ADD COLUMN genus text;

CREATE TABLE plants_inventory.taxonomy_seasonal_fact (
  id uuid PRIMARY KEY,
  taxonomy_reference_id uuid NOT NULL REFERENCES plants_inventory.taxonomy_reference (id),
  hemisphere text NOT NULL,
  -- All timing/duration columns below are nullable: never fabricate a
  -- window a crop does not have (see this file's own header).
  sow_indoors_start_month integer,
  sow_indoors_end_month integer,
  sow_outdoors_start_month integer,
  sow_outdoors_end_month integer,
  transplant_start_month integer,
  transplant_end_month integer,
  harvest_start_month integer,
  harvest_end_month integer,
  days_to_maturity_min integer,
  days_to_maturity_max integer,
  -- Null = no succession benefit for this crop.
  succession_interval_days integer,
  -- Null = no known family-conflict rest period.
  rotation_rest_seasons integer,
  authoring_method text NOT NULL,
  source_citation text,
  review_status text NOT NULL,
  -- Human reviewer name/identifier, NOT an `identity_access.profile`
  -- reference — mirrors `garden_context_fact.reviewed_by`'s own reasoning
  -- exactly: a horticultural reviewer signing off seasonal content is not
  -- necessarily a profile with an account.
  reviewed_by text,
  reviewed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taxonomy_seasonal_fact_taxonomy_hemisphere_key
    UNIQUE (taxonomy_reference_id, hemisphere),
  CONSTRAINT taxonomy_seasonal_fact_hemisphere_check CHECK (
    hemisphere IN ('northern', 'southern')
  ),
  CONSTRAINT taxonomy_seasonal_fact_sow_indoors_start_month_check CHECK (
    sow_indoors_start_month IS NULL OR sow_indoors_start_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_sow_indoors_end_month_check CHECK (
    sow_indoors_end_month IS NULL OR sow_indoors_end_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_sow_outdoors_start_month_check CHECK (
    sow_outdoors_start_month IS NULL OR sow_outdoors_start_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_sow_outdoors_end_month_check CHECK (
    sow_outdoors_end_month IS NULL OR sow_outdoors_end_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_transplant_start_month_check CHECK (
    transplant_start_month IS NULL OR transplant_start_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_transplant_end_month_check CHECK (
    transplant_end_month IS NULL OR transplant_end_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_harvest_start_month_check CHECK (
    harvest_start_month IS NULL OR harvest_start_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_harvest_end_month_check CHECK (
    harvest_end_month IS NULL OR harvest_end_month BETWEEN 1 AND 12
  ),
  CONSTRAINT taxonomy_seasonal_fact_days_to_maturity_min_check CHECK (
    days_to_maturity_min IS NULL OR days_to_maturity_min > 0
  ),
  CONSTRAINT taxonomy_seasonal_fact_days_to_maturity_max_check CHECK (
    days_to_maturity_max IS NULL OR days_to_maturity_max > 0
  ),
  -- `A IS NULL OR B IS NULL OR A <= B`: true whenever either bound is
  -- absent, so this never fights the nullability above — it only rejects a
  -- MIN that is greater than an explicitly given MAX.
  CONSTRAINT taxonomy_seasonal_fact_days_to_maturity_range_check CHECK (
    days_to_maturity_min IS NULL OR days_to_maturity_max IS NULL
    OR days_to_maturity_min <= days_to_maturity_max
  ),
  CONSTRAINT taxonomy_seasonal_fact_succession_interval_days_check CHECK (
    succession_interval_days IS NULL OR succession_interval_days > 0
  ),
  CONSTRAINT taxonomy_seasonal_fact_rotation_rest_seasons_check CHECK (
    rotation_rest_seasons IS NULL OR rotation_rest_seasons > 0
  ),
  CONSTRAINT taxonomy_seasonal_fact_authoring_method_check CHECK (
    authoring_method IN ('human_authored', 'ai_extracted_from_source', 'ai_proposed_reviewed')
  ),
  -- Mirrors `garden_context_fact_source_reviewed_linkage_check`'s clean-
  -- equivalence style: `authoring_method` itself is the discriminant, so
  -- "source_citation present" and "authoring method is extraction" are the
  -- same fact stated two ways.
  CONSTRAINT taxonomy_seasonal_fact_source_citation_linkage_check CHECK (
    (authoring_method = 'ai_extracted_from_source') = (source_citation IS NOT NULL)
  ),
  CONSTRAINT taxonomy_seasonal_fact_review_status_check CHECK (
    review_status IN ('awaiting_horticultural_review', 'horticulturally_reviewed')
  ),
  -- Same clean-equivalence style, applied to the review pairing — mirrors
  -- `garden_context_fact_source_reviewed_linkage_check`.
  CONSTRAINT taxonomy_seasonal_fact_reviewed_linkage_check CHECK (
    (review_status = 'horticulturally_reviewed') = (reviewed_by IS NOT NULL)
  ),
  -- Paired columns: mirrors `garden_context_fact_reviewed_on_linkage_check`
  -- exactly — the second half of the same two-CHECK pattern, combined with
  -- the CHECK above `reviewed_by`/`reviewed_on` are NOT NULL together, NULL
  -- together, and required together exactly when
  -- `review_status = 'horticulturally_reviewed'`.
  CONSTRAINT taxonomy_seasonal_fact_reviewed_on_linkage_check CHECK (
    (reviewed_by IS NULL) = (reviewed_on IS NULL)
  )
);

-- Bed-occupancy history (see this file's own header): three nullable
-- snapshot columns on the existing per-plant revision journal, populated
-- only by the commands that actually change the field they carry.
ALTER TABLE plants_inventory.plant_revision
  ADD COLUMN garden_area_map_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  ADD COLUMN placement_map_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  ADD COLUMN taxonomy_reference_id uuid REFERENCES plants_inventory.taxonomy_reference (id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE plants_inventory.plant_revision
  DROP COLUMN IF EXISTS garden_area_map_object_id,
  DROP COLUMN IF EXISTS placement_map_object_id,
  DROP COLUMN IF EXISTS taxonomy_reference_id;

DROP TABLE IF EXISTS plants_inventory.taxonomy_seasonal_fact CASCADE;

ALTER TABLE plants_inventory.taxonomy_reference
  DROP COLUMN IF EXISTS family,
  DROP COLUMN IF EXISTS genus;

RESET ROLE;
