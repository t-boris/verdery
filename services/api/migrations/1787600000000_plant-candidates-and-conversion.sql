-- Plant candidates and conversion (P11-DATA-01, Phase 11 — see ADR-0016 for
-- the full concept-to-table mapping this migration implements).
--
-- A candidate is a plant being CONSIDERED for a garden, not present in it —
-- excluded from inventory counts, current-care tasks, and "what grows here"
-- claims BY CONSTRUCTION: it lives in its own table, never a status value on
-- `plants_inventory.plant`. `plant.lifecycle_stage`'s existing `'planned'`
-- value means something different and is not reused here: a `'planned'`
-- plant is an already-decided, already-present row (e.g. "seeds sown, not
-- yet sprouted"); a candidate has not been decided on at all. See ADR-0016
-- section 1.
--
-- `plant_candidate` mirrors `plant`'s own shape closely (garden-scoped,
-- optimistic-concurrency `revision`, the same `taxonomy_reference_id`/
-- `variety_label`/`grouping_kind`/`quantity` identity fields, the same
-- placement columns renamed `proposed_*` since a candidate's location is
-- proposed, not accepted garden state) so `AddCandidate`/`ConvertCandidate`
-- read like `AddPlant`, not a new dialect. `status` is deliberately a small,
-- separate vocabulary from `plant_status`: a candidate is `active`,
-- `converted` (terminal, see `candidate_conversion` below), `archived`
-- (owner decided against it, kept for history), or `rejected` (suitability
-- ruled it out) — none of `plant`'s dormant/removed/dead apply to something
-- never planted.
--
-- No revision-journal table for candidates this pass (unlike `plant`/
-- `plant_revision`): nothing today needs point-in-time reconstruction of a
-- candidate's history the way `taxonomy_seasonal_fact`'s bed-occupancy
-- history needed `plant_revision`'s snapshot columns. The `revision` column
-- alone gives real optimistic concurrency (guarded update, same pattern as
-- `apply-plant-revision-guarded-update.ts`); a journal can be added later
-- without breaking anything if a real requirement appears. Deliberately
-- scoped out, not overlooked.
--
-- `alternative_to_candidate_id` is a single, deliberately narrow
-- self-reference ("this candidate is an alternative to that one"), not a
-- full alternatives-set/grouping model — the design doc names "alternative
-- candidates" as a capability but no product decision defines grouping
-- semantics (mutual exclusivity? ranked preference? open set?) yet. One
-- nullable self-FK is the honest amount to build against an undecided
-- requirement; it is never auto-populated by this migration.
--
-- `candidate_conversion` enforces idempotent, at-most-once conversion
-- structurally: `UNIQUE (candidate_id)` means a second `ConvertCandidate`
-- call for the same candidate cannot create a second actual plant, racing or
-- not — the same unique-constraint-as-idempotency-guard shape
-- `plant_taxonomy_mapping_live_identity_idx` already uses. The candidate
-- row itself flips to `status = 'converted'` in the same transaction as the
-- new `plant` row and this join row, but the join row — not the status
-- value — is authoritative for "was this converted, and into which plant,
-- by whom, when": `status` alone could not survive a future candidate
-- lifecycle change without losing that history.
--
-- `candidate_suitability_assessment` is storage only this pass, schema
-- before rules — the same staging `taxonomy_seasonal_fact` (P9D-SEASON-
-- DATA-01) used before its own rule stage, and `P11-SUIT-01`'s explicit
-- position in the work-package dependency order (implementation-plan.md
-- section 20.3: P11-SUIT-01 depends on P11-DATA-01/02, not the reverse). No
-- command in this migration's own work package writes to this table.
-- `result` is `jsonb`, its internal shape (matches/cautions/blockers/
-- unknowns/assumptions/evidence — design doc section 10) defined and
-- validated by P11-SUIT-01's own application-layer schema when that stage
-- exists, not by a CHECK here — the same posture `media_processing_job.
-- result_summary`/`quality_diagnostics` already use for a result shape only
-- the producing stage's own code understands. Append-only: a garden-context
-- or source-fact change produces a new row (design doc section 10:
-- "recalculation when garden context or source facts change"), never an
-- edit to a past assessment — the same versioning-by-insertion
-- `plant_content_record` already established.
--
-- Source: implementation-plan.md work package P11-DATA-01;
--         architecture/plant-intelligence-and-visual-journal.md, sections
--         "3.3 Candidate", "3.4 Candidate Conversion", "4. Data Model",
--         "10. Suitability Assessment";
--         architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE plants_inventory.plant_candidate (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  proposed_garden_area_map_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  proposed_placement_map_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  display_name text NOT NULL,
  -- Nullable: an unidentified candidate ("something I saw at the nursery") is a valid state.
  taxonomy_reference_id uuid REFERENCES plants_inventory.taxonomy_reference (id),
  variety_label text,
  grouping_kind text NOT NULL DEFAULT 'individual',
  quantity integer,
  status text NOT NULL DEFAULT 'active',
  rationale_note text,
  priority text,
  price_amount numeric(10, 2),
  price_currency text,
  purchase_source text,
  alternative_to_candidate_id uuid REFERENCES plants_inventory.plant_candidate (id),
  revision integer NOT NULL DEFAULT 1,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_candidate_grouping_kind_check CHECK (
    grouping_kind IN ('individual', 'row', 'group')
  ),
  CONSTRAINT plant_candidate_quantity_positive_check CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT plant_candidate_status_check CHECK (
    status IN ('active', 'converted', 'archived', 'rejected')
  ),
  CONSTRAINT plant_candidate_priority_check CHECK (
    priority IS NULL OR priority IN ('low', 'medium', 'high')
  ),
  -- A price without a currency, or a currency with no amount, is not a usable fact.
  CONSTRAINT plant_candidate_price_pair_check CHECK (
    (price_amount IS NULL) = (price_currency IS NULL)
  ),
  CONSTRAINT plant_candidate_price_amount_check CHECK (price_amount IS NULL OR price_amount >= 0),
  CONSTRAINT plant_candidate_price_currency_check CHECK (
    price_currency IS NULL OR price_currency <> ''
  ),
  CONSTRAINT plant_candidate_not_own_alternative_check CHECK (alternative_to_candidate_id <> id)
);

CREATE INDEX plant_candidate_garden_status_idx
  ON plants_inventory.plant_candidate (garden_id, status);

-- At most one actual plant per candidate, structurally — see this file's own header.
CREATE TABLE plants_inventory.candidate_conversion (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL UNIQUE REFERENCES plants_inventory.plant_candidate (id),
  plant_id uuid NOT NULL UNIQUE REFERENCES plants_inventory.plant (id),
  converted_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  converted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plants_inventory.candidate_suitability_assessment (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES plants_inventory.plant_candidate (id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Serves "the latest assessment for this candidate" — the same
-- `(key, fetched_at DESC) LIMIT 1` shape `plant_content_record_provider_
-- taxon_fetched_idx` already established for an append-only, latest-wins read.
CREATE INDEX candidate_suitability_assessment_candidate_id_idx
  ON plants_inventory.candidate_suitability_assessment (candidate_id, created_at DESC);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS plants_inventory.candidate_suitability_assessment CASCADE;
DROP TABLE IF EXISTS plants_inventory.candidate_conversion CASCADE;
DROP TABLE IF EXISTS plants_inventory.plant_candidate CASCADE;

RESET ROLE;
