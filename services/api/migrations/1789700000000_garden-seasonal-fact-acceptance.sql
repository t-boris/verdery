-- Records that one garden's owner or editor accepted one seasonal timing
-- fact FOR THAT GARDEN.
--
-- THE PROBLEM THIS SOLVES. Three rules (sowing window, succession
-- replanting, crop rotation) read only `horticulturally_reviewed` rows of
-- `taxonomy_seasonal_fact`. Nothing could ever reach that state: the sign-off
-- required a named horticulturist drawn from `PLANT_REVIEWER_EMAILS`, which
-- was never wired through to the deployed service, so the allowlist was
-- empty and the queue refused every caller. The rules were permanently
-- silent and the seeded taxa sat unreadable. The gate was real, but it had
-- no key.
--
-- WHY PER GARDEN, AND WHY THAT IS SAFE. `taxonomy_seasonal_fact` has no
-- `garden_id` — one row is the timing for a taxon in a hemisphere, shared by
-- every garden. So "let a garden owner mark rows reviewed" would have
-- published one gardener's judgment into everyone else's gardens, which is
-- precisely the authority the horticulturist gate existed to withhold.
-- Recording the acceptance HERE instead, keyed by garden, means a decision
-- reaches exactly the garden whose owner made it. The blast radius is the
-- accepting garden, which is the same scope that owner already controls.
--
-- WHY NOT A `garden_id` COLUMN ON THE FACT ITSELF. The content is not what
-- differs between gardens; the decision is. Adding `garden_id` there would
-- strand the seeded rows (they belong to no garden) and force identical
-- timing to be copied per garden, where the copies could then drift apart
-- and no longer be the one thing a citation refers to. Content stays single;
-- decisions multiply.
--
-- WHAT THIS TABLE IS NOT. It is not a second authoring path. It references a
-- fact that already exists and says nothing about its contents, so accepting
-- can never invent timing, and the AI proposal lane still lands only as
-- `awaiting_horticultural_review`. `taxonomy_seasonal_fact` has no update
-- path, so the row an acceptance points at cannot change underneath it.
--
-- ON DELETE CASCADE from the garden: the acceptance is a statement about
-- that garden. With the garden gone there is no one it speaks for, and
-- retaining it would block deletion for no reason. The fact reference is
-- RESTRICT by omission of a cascade — deleting shared content that gardens
-- have accepted should fail loudly rather than silently retract decisions.
--
-- Source: docs/architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
--         docs/development/recommendation-safety-catalog.md;
--         modules/gardens-mapping/domain/garden-role.ts (`editGardenContent`).

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE plants_inventory.garden_seasonal_fact_acceptance (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL
    REFERENCES gardens_mapping.garden (id) ON DELETE CASCADE,
  taxonomy_seasonal_fact_id uuid NOT NULL
    REFERENCES plants_inventory.taxonomy_seasonal_fact (id),
  -- The accepting person, always the authenticated caller rather than a
  -- caller-supplied value, so this is an accountable claim about who decided
  -- rather than a decorative field.
  accepted_by_profile_id uuid NOT NULL
    REFERENCES identity_access.profile (id),
  -- Date, not timestamp: this matches `taxonomy_seasonal_fact.reviewed_on`,
  -- and the useful question is which day someone signed off, not which
  -- millisecond.
  accepted_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- One acceptance per garden per fact. A repeated accept is idempotent
  -- rather than a second, conflicting record of the same decision.
  CONSTRAINT garden_seasonal_fact_acceptance_garden_fact_key
    UNIQUE (garden_id, taxonomy_seasonal_fact_id)
);

-- The rule-facing read is "does THIS garden accept the fact for this taxon
-- and hemisphere", which joins from the garden side; the unique constraint
-- above already leads with `garden_id` and serves it. This index serves the
-- opposite direction only — finding which gardens accepted a given fact,
-- which the deletion path needs in order to fail loudly rather than scan.
CREATE INDEX garden_seasonal_fact_acceptance_fact_idx
  ON plants_inventory.garden_seasonal_fact_acceptance (taxonomy_seasonal_fact_id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS plants_inventory.garden_seasonal_fact_acceptance;

RESET ROLE;
