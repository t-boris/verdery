-- Records when each garden was last evaluated, so the recommendation sweep
-- can run often without re-evaluating gardens nothing has happened to.
--
-- THE PROBLEM THIS SOLVES. The sweep drains every eligible garden on every
-- run, which is correct but made the interval a direct trade between
-- responsiveness and cost. It was set to six hours, so adding a plant
-- produced nothing at all until the next tick — for a plant added just
-- after one, most of a working day. "Add a plant and see what it needs" is
-- the product's core loop, and six hours is not an answer to it.
--
-- With a watermark the sweep can run every few minutes and still do almost
-- no work: a garden is DUE only when something it depends on changed since
-- its last evaluation, or when enough time has passed that a time-based
-- rule could newly fire on its own.
--
-- WHY A SEPARATE TABLE RATHER THAN A COLUMN ON `garden`. `gardens_mapping`
-- owns that table and this is `tasks_recommendations`' bookkeeping; a module
-- writing a column in another module's table is exactly the boundary this
-- codebase keeps. Cross-schema READS are already established (the sweep's
-- own eligibility query reads `plant`), and a read is what the due-check
-- needs.
--
-- WHY NOT DERIVE IT FROM `recommendation_candidate.created_at`. Because an
-- evaluation that suppresses everything — the overwhelmingly common case —
-- writes no candidate at all. Its own outcome leaves no trace, so a
-- candidate timestamp cannot say when the garden was last looked at, only
-- when it last produced something.
--
-- ON DELETE CASCADE: this row is pure derived bookkeeping about a garden.
-- When the garden is gone there is nothing to remember, and keeping the row
-- would block deletion for no reason.
--
-- Source: architecture/recommendations-and-ai.md, section "3. Recommendation
--         Pipeline"; application/run-recommendation-evaluation-sweep.ts.

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE tasks_recommendations.garden_evaluation_state (
  garden_id uuid PRIMARY KEY
    REFERENCES gardens_mapping.garden (id) ON DELETE CASCADE,
  -- The evaluation instant of the most recent completed evaluation, always
  -- the injected clock's reading rather than `now()`, so a test with a fixed
  -- clock and production agree about what "last evaluated" means.
  last_evaluated_at timestamptz NOT NULL
);

-- The due-check reads this by garden id (the primary key) and, for the
-- staleness floor, scans for gardens whose watermark is old. The partial
-- ordering index serves the second shape.
CREATE INDEX garden_evaluation_state_last_evaluated_at_idx
  ON tasks_recommendations.garden_evaluation_state (last_evaluated_at ASC);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS tasks_recommendations.garden_evaluation_state;

RESET ROLE;
