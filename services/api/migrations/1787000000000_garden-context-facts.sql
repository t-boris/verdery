-- Garden context facts (P9D-CONTEXT-01): reviewed facts about a garden's
-- physical growing environment — sun exposure, soil type, drainage,
-- irrigation method, growing context (open ground / container / greenhouse),
-- and microclimate — each carrying its own source and quality, per FR-22's
-- own requirement that "the source and quality of each context type must be
-- understood before it influences high-impact guidance".
--
-- One row per (garden, contextKind), UNIQUE-constrained, update-in-place —
-- FR-22 asks that the CURRENT value's source/quality be known, not for a
-- timeline of context changes, so this is not an append-only history table
-- the way `garden_object_revision` is.
--
-- `value`'s vocabulary is enforced here for the two-word CHECK-able kinds
-- (`sun_exposure`, `drainage`, `irrigation_method`, `growing_context`) is
-- deliberately NOT a database CHECK: `soil_type` and `microclimate` are free
-- text (the same latitude `bed_details.soil_notes` already takes — see
-- `1784800000000_garden-map-baseline.sql`), so a single per-kind CHECK
-- cannot cover all six kinds uniformly. The full per-kind vocabulary is
-- validated at the application layer instead
-- (`domain/garden-context-fact.ts`); only "not blank" is enforced here.
--
-- Deliberately NOT reusing `garden_object.provenance`/`confidence`: those
-- describe how a MAP SHAPE was captured (drawing, AR measurement, ...), a
-- different concept from how a soil/sun FACT was sourced.
--
-- Source: implementation-plan.md §18.2, work package P9D-CONTEXT-01;
--         technical-specification.md FR-22 ("Garden Context").

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE gardens_mapping.garden_context_fact (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  context_kind text NOT NULL,
  value text NOT NULL,
  source text NOT NULL,
  -- Human reviewer name/identifier, NOT a `identity_access.profile`
  -- reference — a horticultural reviewer signing off a regional default is
  -- not necessarily a profile with an account, unlike `recorded_by_profile_id`
  -- below, which always is.
  reviewed_by text,
  reviewed_on date,
  recorded_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT garden_context_fact_garden_context_kind_key UNIQUE (garden_id, context_kind),
  CONSTRAINT garden_context_fact_context_kind_check CHECK (context_kind IN (
    'sun_exposure', 'soil_type', 'drainage', 'irrigation_method', 'growing_context', 'microclimate'
  )),
  CONSTRAINT garden_context_fact_value_not_blank_check CHECK (btrim(value) <> ''),
  CONSTRAINT garden_context_fact_source_check CHECK (source IN (
    'user_declared', 'horticulturally_reviewed_default', 'imported'
  )),
  -- Mirrors `client_update_withdrawn_linkage_check`'s clean-equivalence
  -- style (1786700000000_client-publication-and-work-logs.sql): `source`
  -- itself is the discriminant, so "reviewed_by present" and "source is the
  -- reviewed-default source" are the same fact stated two ways.
  CONSTRAINT garden_context_fact_source_reviewed_linkage_check CHECK (
    (source = 'horticulturally_reviewed_default') = (reviewed_by IS NOT NULL)
  ),
  -- Paired columns: mirrors `client_update_withdrawn_by_linkage_check`'s
  -- pure-pairing style, the second half of the same two-CHECK pattern.
  -- Combined with the CHECK above, `reviewed_by`/`reviewed_on` are NOT NULL
  -- together, NULL together, and required together exactly when
  -- `source = 'horticulturally_reviewed_default'`.
  CONSTRAINT garden_context_fact_reviewed_on_linkage_check CHECK (
    (reviewed_by IS NULL) = (reviewed_on IS NULL)
  )
);

-- No separate `garden_id` index: `garden_context_fact_garden_context_kind_key`
-- already leads with `garden_id`, so it also serves "every fact for this
-- garden" (`ListGardenContextFacts`'s own query) without a redundant index.

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS gardens_mapping.garden_context_fact CASCADE;

RESET ROLE;
