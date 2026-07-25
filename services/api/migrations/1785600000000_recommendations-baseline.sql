-- Recommendations baseline: the recommendation side of the
-- `tasks_recommendations` schema that Phase 4's own migration
-- (1784900000000_plants-observations-tasks-baseline.sql) explicitly
-- deferred — its comment on `task` reads "`origin_recommendation_id`: the
-- Recommendation entity does not exist yet — Phase 4 populates only the
-- task side of `tasks_recommendations`". This migration populates the
-- recommendation side: versioned rule identities, recommendation
-- candidates with their presentation-state lifecycle, physically-required
-- structured evidence, priority factors, user feedback, and supersession
-- history — and completes that deferred `task.origin_recommendation_id`
-- column now that its FK target exists.
--
-- This is P7-DATA-01: data model and domain logic only. No HTTP endpoint,
-- no rule ENGINE (eligibility conditions, action templates, applicability,
-- reviewer metadata, and the rule catalog itself are P7-RULE-01), no
-- scheduler (P7-ASYNC-01), no Today commands (P7-BE-01), and no Vertex AI
-- explanation record (P7-AI-01 owns prompt-template/model/config versions,
-- generated text, validation outcome, and fallback text — section 10's
-- field list — which is why no explanation or action-text column appears
-- below: nothing this stage builds can produce one, and the stage that can
-- owns its shape).
--
-- Backfill posture: every table below is new, so no existing row is ever
-- rewritten. The single ALTER against an existing table adds one nullable,
-- default-free column (`task.origin_recommendation_id`) plus a CHECK whose
-- validation scan can only pass or fail loudly; see that ALTER's own
-- comment for the three independent facts making it safe against every
-- real deployment.
--
-- Grants: `verdery_application` gains row access to every table below
-- automatically, through the platform baseline's ALTER DEFAULT PRIVILEGES
-- loop for module schemas. `verdery_worker` deliberately gets NOTHING here:
-- no worker touches recommendations yet — P7-ASYNC-01's scheduled
-- generation is the stage that will name exactly which tables its relay
-- needs, matching how 1785200000000_media-processing-jobs.sql granted that
-- role only the two tables its relay actually reads.
--
-- Source: implementation-plan.md work package P7-DATA-01;
--         architecture/recommendations-and-ai.md, sections
--         "4. Structured Inputs", "5. Rule Engine", "6. Candidate
--         Lifecycle", "7. Priority", "10. Explanation Generation",
--         "13. Safety Tiers", "19. Completion Criteria";
--         technical-specification.md, section "FR-24: Recommendations".

-- Up Migration

SET ROLE verdery_migration;

-- Versioned rule identity — the thing a candidate pins so "every
-- recommendation references ... a rule version" (section 19) can be a
-- foreign key rather than a convention. Deliberately identity-plus-tier
-- ONLY: section 5's rule contents (eligibility conditions, required and
-- optional evidence, time window and recurrence behavior, priority inputs,
-- exclusion and safety conditions, suggested action template, explanation
-- facts, applicability, content and reviewer metadata) are the rule
-- ENGINE's catalog, owned by P7-RULE-01 — modeling those columns here,
-- with no engine to read them and no reviewed catalog to fill them, would
-- freeze shapes that stage owns. `safety_tier` is the one piece of rule
-- metadata this data model itself depends on: the candidate table below
-- pins it structurally (see its composite FK) to make section 13's
-- restricted-tier exclusion physical, so it must live on the versioned,
-- immutable identity row.
--
-- Append-only and immutable: "Rules execute deterministically for the same
-- versioned inputs" (section 5) — a rule whose content changes gets a new
-- `(rule_key, version)` row, never an UPDATE, the same no-update posture
-- `plants_inventory.taxonomy_reference` documents for its own referenced-
-- by-id rows.
--
-- `rule_key` is free text under a non-blank CHECK, not an enumerated set,
-- for the same reason `media.processing_job.job_kind` is: the launch rule
-- catalog does not exist yet (P7-RULE-01, gated on horticulture review),
-- so there is no closed list to enumerate.
CREATE TABLE tasks_recommendations.rule_version (
  id uuid PRIMARY KEY,
  rule_key text NOT NULL,
  version integer NOT NULL,
  safety_tier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_version_rule_key_check CHECK (rule_key <> ''),
  CONSTRAINT rule_version_version_positive_check CHECK (version > 0),
  CONSTRAINT rule_version_safety_tier_check CHECK (
    safety_tier IN ('ordinary_care', 'elevated_risk', 'restricted')
  ),
  CONSTRAINT rule_version_rule_key_version_key UNIQUE (rule_key, version),
  -- Exists solely so `recommendation_candidate` below can pair
  -- `rule_version_id` with `safety_tier` in one composite FK — the trick
  -- that makes a candidate's stored tier provably the rule's own tier,
  -- never a free-floating claim.
  CONSTRAINT rule_version_id_safety_tier_key UNIQUE (id, safety_tier)
);

-- Recommendation candidates: one row per persisted candidate, carrying
-- FR-24's own field list ("Affected garden, area, or plant", "Urgency",
-- "Relevant deadline or time window") and section 6's lifecycle as a
-- CHECK-enumerated `state`.
--
-- Target trio and its consistency CHECK mirror
-- `tasks_recommendations.task`'s own `target_kind` pattern exactly —
-- FR-24's "Affected garden, area, or plant" is the same one-of-three
-- reference FR-25 gives tasks.
--
-- `care_category` is required but NOT CHECK-enumerated: P0-PROD-03
-- ("Freeze ... initial care categories") is a still-undecided product
-- selection — no care-category vocabulary exists anywhere in this
-- repository's docs or code today (unlike lifecycle stages, task states,
-- and urgency levels, which have been live since Phase 4). A non-blank
-- free-text column carries the field the work package names without
-- preempting that pending decision; the CHECK arrives with the frozen
-- glossary. Same posture `media.processing_job.job_kind` took for its own
-- not-yet-closed vocabulary.
--
-- `urgency` reuses the task table's own four-level vocabulary verbatim —
-- P0-PROD-03 names "recommendation urgency levels" and "task states" as
-- one glossary, and a candidate a user acts on may become a suggested
-- task (FR-25: "The application may suggest tasks from observations and
-- recommendations"), so the two columns must speak the same levels.
--
-- `rule_version_id` + `safety_tier` form ONE composite FK onto
-- `rule_version (id, safety_tier)` — deliberately instead of a plain
-- single-column FK, which it subsumes. This pins the candidate's stored
-- tier to the referenced rule's own tier (a mismatched pair cannot be
-- inserted), and the `generatable_safety_tier` CHECK then excludes
-- 'restricted' outright: section 13's "Restricted" guidance "require[s]
-- dedicated policy and may be excluded from generated recommendations" —
-- until that dedicated policy exists, exclusion is the only safe reading,
-- and this makes it physical: no candidate row for a restricted-tier rule
-- can exist at all. A future policy stage relaxes the CHECK by migration;
-- unsafe rows never exist in the meantime.
--
-- `primary_evidence_id` is the evidence-enforcement half of section 19's
-- "Every recommendation references structured evidence": NOT NULL, and
-- closed into a deferred composite FK after `recommendation_evidence`
-- below exists (a single CREATE TABLE cannot express a circular reference
-- — the same two-step `plant`/`plant_identification` already use). See
-- that ALTER's own comment.
--
-- `supersedes_candidate_id` is section 6's "A superseding recommendation
-- references the prior record", read literally: the NEWER candidate points
-- backward at the record it replaces, the same direction
-- `media.media_record.derived_from_media_id` and
-- `observations_history.observation.corrects_observation_id` model their
-- own self-relations. The composite FK through `(garden_id, ...)` makes a
-- cross-garden supersession physically impossible (the testing section's
-- "Cross-garden authorization" concern applied to the one relationship
-- rows of different gardens could otherwise share), and the partial UNIQUE
-- index below caps the history at one successor per prior record —
-- superseding an already-superseded candidate means pointing at the chain
-- head, keeping the history a walkable chain, not a tree.
--
-- `presented_at` pins section 6's one non-terminal user-visible fact:
-- pre-presentation states must not carry it, the four states reachable
-- only through presentation must, and `expired`/`superseded` may hold
-- either (both are reachable from pre- and post-presentation states — see
-- the lifecycle functions' own comments in
-- `domain/recommendation-lifecycle.ts`).
--
-- `revision`/`updated_at`: the same plain optimistic-concurrency counter
-- `media.media_record` uses — state transitions are server-owned; no
-- revision journal table, because no Phase 7 work package asks for one
-- (user actions get their own append-only trail in
-- `recommendation_feedback` below).
CREATE TABLE tasks_recommendations.recommendation_candidate (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  target_kind text NOT NULL,
  target_garden_area_id uuid REFERENCES gardens_mapping.garden_object (id),
  target_plant_id uuid REFERENCES plants_inventory.plant (id),
  care_category text NOT NULL,
  rule_version_id uuid NOT NULL,
  safety_tier text NOT NULL,
  state text NOT NULL DEFAULT 'generated',
  urgency text NOT NULL DEFAULT 'normal',
  window_start timestamptz,
  window_end timestamptz,
  primary_evidence_id uuid NOT NULL,
  supersedes_candidate_id uuid,
  presented_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_candidate_target_kind_check CHECK (
    target_kind IN ('garden', 'garden_area', 'plant')
  ),
  CONSTRAINT recommendation_candidate_target_consistency_check CHECK (
    (target_kind = 'garden' AND target_garden_area_id IS NULL AND target_plant_id IS NULL)
    OR (target_kind = 'garden_area' AND target_garden_area_id IS NOT NULL
        AND target_plant_id IS NULL)
    OR (target_kind = 'plant' AND target_plant_id IS NOT NULL AND target_garden_area_id IS NULL)
  ),
  CONSTRAINT recommendation_candidate_care_category_check CHECK (care_category <> ''),
  CONSTRAINT recommendation_candidate_state_check CHECK (state IN (
    'generated', 'eligible', 'presented', 'completed', 'postponed', 'rejected',
    'expired', 'superseded'
  )),
  CONSTRAINT recommendation_candidate_urgency_check CHECK (
    urgency IN ('low', 'normal', 'high', 'urgent')
  ),
  CONSTRAINT recommendation_candidate_window_check CHECK (
    window_start IS NULL OR window_end IS NULL OR window_start <= window_end
  ),
  CONSTRAINT recommendation_candidate_generatable_safety_tier_check CHECK (
    safety_tier IN ('ordinary_care', 'elevated_risk')
  ),
  CONSTRAINT recommendation_candidate_rule_version_fkey
    FOREIGN KEY (rule_version_id, safety_tier)
    REFERENCES tasks_recommendations.rule_version (id, safety_tier),
  CONSTRAINT recommendation_candidate_no_self_supersession_check CHECK (
    supersedes_candidate_id IS NULL OR supersedes_candidate_id <> id
  ),
  -- Exists solely for the same-garden composite FKs (supersession here,
  -- and any future same-garden pairing) — the `rule_version_id_safety_tier`
  -- judgment applied to garden scoping.
  CONSTRAINT recommendation_candidate_garden_scoped_id_key UNIQUE (garden_id, id),
  CONSTRAINT recommendation_candidate_supersedes_fkey
    FOREIGN KEY (garden_id, supersedes_candidate_id)
    REFERENCES tasks_recommendations.recommendation_candidate (garden_id, id),
  -- Two implications, deliberately not a three-branch whitelist: state
  -- VOCABULARY is `recommendation_candidate_state_check`'s single concern
  -- above, so an unrecognized state must fail that constraint alone, not
  -- this one too. `expired`/`superseded` match neither antecedent and are
  -- free to hold either value — both are reachable from pre- and
  -- post-presentation states.
  CONSTRAINT recommendation_candidate_presentation_timestamp_check CHECK (
    (state NOT IN ('generated', 'eligible') OR presented_at IS NULL)
    AND (state NOT IN ('presented', 'completed', 'postponed', 'rejected')
         OR presented_at IS NOT NULL)
  )
);

-- Serves "candidates in this garden, filtered by state" listing queries —
-- the exact judgment `task_garden_status_idx` makes for tasks, and the
-- shape Today's queries (P7-BE-01) will read.
CREATE INDEX recommendation_candidate_garden_state_idx
  ON tasks_recommendations.recommendation_candidate (garden_id, state);
CREATE INDEX recommendation_candidate_target_garden_area_id_idx
  ON tasks_recommendations.recommendation_candidate (target_garden_area_id)
  WHERE target_garden_area_id IS NOT NULL;
CREATE INDEX recommendation_candidate_target_plant_id_idx
  ON tasks_recommendations.recommendation_candidate (target_plant_id)
  WHERE target_plant_id IS NOT NULL;
-- Serves "every candidate this rule version produced" — section 18's
-- "Model-version replay and audit" applied to rules, and the natural
-- rollout/rollback question when a rule version changes.
CREATE INDEX recommendation_candidate_rule_version_id_idx
  ON tasks_recommendations.recommendation_candidate (rule_version_id);
-- At most ONE successor per superseded record — see the table comment's
-- "walkable chain, not a tree".
CREATE UNIQUE INDEX recommendation_candidate_supersedes_candidate_id_key
  ON tasks_recommendations.recommendation_candidate (supersedes_candidate_id)
  WHERE supersedes_candidate_id IS NOT NULL;
-- Serves the P7-ASYNC-01 expiry sweep's own scan: live candidates whose
-- validity window has passed. Partial on exactly the three live states so
-- the terminal majority never bloats it.
CREATE INDEX recommendation_candidate_live_window_end_idx
  ON tasks_recommendations.recommendation_candidate (window_end)
  WHERE state IN ('generated', 'eligible', 'presented') AND window_end IS NOT NULL;

-- Structured evidence — section 4's input list as a CHECK-enumerated
-- vocabulary, one row per fact that justified the candidate. Append-only
-- and immutable: section 6's "Presentation does not overwrite generation
-- evidence" — no UPDATE path exists, matching
-- `observations_history.observation`'s own no-update posture.
--
-- `evidence_kind` maps section 4's bullets one-to-one: "Plant identity and
-- confidence" -> plant_identity; "Garden location, time zone, and season"
-- -> garden_context; "Weather observations and forecast freshness" ->
-- weather; "Soil or moisture facts" -> soil_moisture; "Recent observations
-- and tasks" -> observation, task (two kinds from one paired bullet, the
-- same split the priority factors below apply to their own paired bullet);
-- "Plant lifecycle stage" -> lifecycle_stage; "Garden geometry and
-- exposure context" -> geometry_exposure; "User preferences and capability
-- constraints" -> user_preference. The list's remaining bullet,
-- "Horticultural rule and content versions", is not an evidence kind: the
-- candidate already pins it as `rule_version_id`, and duplicating it here
-- would state one fact in two places.
--
-- The reference-consistency CHECK gives each kind exactly the structured
-- reference it can have: `observation`/`task`/plant-fact kinds must point
-- at the real row that is the fact, and context kinds (which have no
-- backing table) must point at nothing. `source_weather_record_id` is a
-- bare, FK-less uuid: normalized weather records
-- (architecture/external-integrations.md, section 5) do not exist as a
-- table anywhere in this codebase yet — P7-INT-01 owns them. Added now
-- anyway so the row shape does not need a second migration once that table
-- exists, the same precedent `media.media_record.capture_session_id`
-- documents; the real FK arrives with P7-INT-01's own migration.
--
-- `fact_key` is section 10's "stable fact identifiers", required on every
-- row; `fact_value` is the value snapshot at generation time, nullable
-- because for reference kinds the referenced row IS the value, and
-- "Missing facts remain missing. The system does not invent a value to
-- complete a recommendation" (section 4).
--
-- `(candidate_id, id)` UNIQUE exists for the candidate's own deferred
-- composite FK below — the pairing that proves a candidate's primary
-- evidence belongs to that candidate and no other.
CREATE TABLE tasks_recommendations.recommendation_evidence (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES tasks_recommendations.recommendation_candidate (id),
  evidence_kind text NOT NULL,
  source_observation_id uuid REFERENCES observations_history.observation (id),
  source_task_id uuid REFERENCES tasks_recommendations.task (id),
  source_plant_id uuid REFERENCES plants_inventory.plant (id),
  source_weather_record_id uuid,
  fact_key text NOT NULL,
  fact_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_evidence_kind_check CHECK (evidence_kind IN (
    'plant_identity', 'garden_context', 'weather', 'soil_moisture', 'observation',
    'task', 'lifecycle_stage', 'geometry_exposure', 'user_preference'
  )),
  CONSTRAINT recommendation_evidence_fact_key_check CHECK (fact_key <> ''),
  CONSTRAINT recommendation_evidence_reference_consistency_check CHECK (
    (evidence_kind = 'observation' AND source_observation_id IS NOT NULL
      AND source_task_id IS NULL AND source_plant_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind = 'task' AND source_task_id IS NOT NULL
      AND source_observation_id IS NULL AND source_plant_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind IN ('plant_identity', 'lifecycle_stage') AND source_plant_id IS NOT NULL
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind = 'weather' AND source_weather_record_id IS NOT NULL
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_plant_id IS NULL)
    OR (evidence_kind IN ('garden_context', 'soil_moisture', 'geometry_exposure',
        'user_preference')
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_plant_id IS NULL AND source_weather_record_id IS NULL)
  ),
  CONSTRAINT recommendation_evidence_candidate_scoped_id_key UNIQUE (candidate_id, id)
);

-- Serve "which candidates does this row justify" reverse lookups — the
-- reference-tracking question data-export-and-deletion asks of every
-- cross-module pointer (the same judgment behind
-- `media_record_derived_from_media_id_idx`).
CREATE INDEX recommendation_evidence_source_observation_id_idx
  ON tasks_recommendations.recommendation_evidence (source_observation_id)
  WHERE source_observation_id IS NOT NULL;
CREATE INDEX recommendation_evidence_source_task_id_idx
  ON tasks_recommendations.recommendation_evidence (source_task_id)
  WHERE source_task_id IS NOT NULL;
CREATE INDEX recommendation_evidence_source_plant_id_idx
  ON tasks_recommendations.recommendation_evidence (source_plant_id)
  WHERE source_plant_id IS NOT NULL;

-- Closes the circular candidate <-> evidence reference the two CREATE
-- TABLE statements above cannot express between them — the same two-step
-- `plant.accepted_identification_id` uses — and, with it, makes section
-- 19's "Every recommendation references structured evidence" PHYSICAL: a
-- candidate row whose transaction commits without at least one evidence
-- row of its own violates this constraint, so an evidence-free candidate
-- cannot exist in a committed database state at all. DEFERRABLE INITIALLY
-- DEFERRED is what allows the candidate to be inserted first and its
-- evidence rows immediately after, inside one transaction — the constraint
-- is checked at COMMIT, not per statement. The composite reference through
-- `(candidate_id, id)` additionally proves the designated primary evidence
-- row belongs to THIS candidate, not merely that some evidence row with
-- that id exists somewhere.
ALTER TABLE tasks_recommendations.recommendation_candidate
  ADD CONSTRAINT recommendation_candidate_primary_evidence_fkey
  FOREIGN KEY (id, primary_evidence_id)
  REFERENCES tasks_recommendations.recommendation_evidence (candidate_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Priority factors — section 7's own bullet list as a CHECK-enumerated
-- vocabulary, one row per factor per candidate: "The application stores
-- the factors needed to explain rank." The kinds map the bullets
-- one-to-one: "Urgency window" -> urgency_window; "Plant impact" ->
-- plant_impact; "Confidence" -> confidence; "Weather opportunity or risk"
-- -> weather_opportunity_or_risk; "User effort and availability" ->
-- user_effort_and_availability; "Existing task overlap" -> task_overlap;
-- "Safety and seasonal constraints" -> safety_constraint,
-- seasonal_constraint (one paired bullet, two kinds — the same split the
-- evidence vocabulary applies to its own paired bullet).
--
-- `factor_value` is jsonb, not a numeric score column, deliberately:
-- section 7 says priority is "an explainable score OR ordered category" —
-- which of the two, and on what scale, is exactly the calculation
-- P7-RULE-01's engine owns ("A black-box ranker may be evaluated later but
-- does not replace baseline explanations without an ADR"). This table pins
-- WHICH factors influenced a candidate and their recorded values' shape is
-- the engine stage's to define; enumerating the kinds while leaving the
-- value structured-but-open is the honest split. NOT NULL because a factor
-- with no recorded value explains nothing.
--
-- Factors are optional per candidate (the pipeline computes priority
-- AFTER candidate generation — section 3's own ordering), so no deferred
-- at-least-one constraint mirrors the evidence one: section 19 requires
-- evidence and a rule version on every recommendation, not factors.
CREATE TABLE tasks_recommendations.recommendation_priority_factor (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES tasks_recommendations.recommendation_candidate (id),
  factor_kind text NOT NULL,
  factor_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_priority_factor_kind_check CHECK (factor_kind IN (
    'urgency_window', 'plant_impact', 'confidence', 'weather_opportunity_or_risk',
    'user_effort_and_availability', 'task_overlap', 'safety_constraint',
    'seasonal_constraint'
  )),
  -- One row per factor per candidate — a duplicated factor kind would
  -- state one explanation twice, possibly contradictorily. Also serves
  -- "all factors for this candidate" lookups via its leading column.
  CONSTRAINT recommendation_priority_factor_candidate_kind_key UNIQUE (candidate_id, factor_kind)
);

-- User feedback — FR-24's "Completion, postponement, dismissal, and
-- relevance feedback controls" as an append-only trail with actor and
-- timestamp, feeding section 16's evaluation loop ("User outcomes feed
-- product quality analysis") and section 17's "User completion,
-- postponement, and rejection" measurements. Append-only: a feedback event
-- happened; it is never edited or deleted, matching
-- `observations_history.observation`'s no-update posture.
--
-- `feedback_kind` speaks FR-24's control vocabulary (completed, postponed,
-- dismissed, irrelevant — the same four verbs P7-BE-01's work package
-- names for its commands). The candidate STATE vocabulary is section 6's
-- (which says `rejected`); the pairing — `dismissed` feedback drives the
-- `rejected` state, `irrelevant` is the explicit quality signal that
-- accompanies or follows a dismissal without a state of its own — is
-- P7-BE-01's command wiring, deliberately not folded into either
-- vocabulary here.
--
-- `postponed_until` may only accompany a postponement, and stays nullable
-- even then: no document names a default or required postponement horizon,
-- and inventing one would violate this migration's own no-invention
-- posture.
CREATE TABLE tasks_recommendations.recommendation_feedback (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES tasks_recommendations.recommendation_candidate (id),
  feedback_kind text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  postponed_until timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_feedback_kind_check CHECK (
    feedback_kind IN ('completed', 'postponed', 'dismissed', 'irrelevant')
  ),
  CONSTRAINT recommendation_feedback_postponed_until_check CHECK (
    postponed_until IS NULL OR feedback_kind = 'postponed'
  )
);

-- Serves "feedback for this candidate, newest first" — the evaluation
-- loop's own read shape, ordered like `observation_garden_id_idx` orders
-- its timeline.
CREATE INDEX recommendation_feedback_candidate_id_idx
  ON tasks_recommendations.recommendation_feedback (candidate_id, recorded_at DESC);

-- Completes the column 1784900000000_plants-observations-tasks-baseline.sql
-- explicitly deferred ("a foreign key cannot target a table that does not
-- exist") now that the table exists. Nullable, default-free, no backfill:
-- three independent facts make both the column and the equivalence CHECK
-- safe against every real deployment. (1) The only INSERT path into
-- `task` anywhere in this codebase is `CreateManualTask`, whose domain
-- constructor (`domain/task.ts`, `createTask`) hardcodes `source:
-- 'manual'` — its own doc comment says "always `'manual'` for every task
-- this module creates". (2) No UPDATE path can change `source`:
-- `TaskDetailChanges` (the one shared details-update shape `EditTask`/
-- `RescheduleTask` both go through) has no `source` field, and no other
-- command writes the column. (3) The sync push path creates tasks only by
-- routing through that same `CreateManualTask` command
-- (`synchronization/application/route-task-operation.ts`), not by raw row
-- writes. Every existing row therefore has `source = 'manual'` and gets
-- `origin_recommendation_id IS NULL`, which satisfies the CHECK's
-- both-false branch — and the ALTER's own validation scan would fail
-- loudly, not silently, if any environment somehow disproved this.
--
-- The CHECK is a full equivalence, not one-way: a suggested task without
-- its originating candidate would break FR-24's explainability chain
-- ("Generated recommendations must retain enough context to explain their
-- origin" — technical-specification.md section 12.4 applies to what they
-- become, too), and a manual task claiming a recommendation origin would
-- be a fabricated provenance. P7-BE-01's task-conversion command is the
-- stage that will set both halves together.
ALTER TABLE tasks_recommendations.task
  ADD COLUMN origin_recommendation_id uuid
    REFERENCES tasks_recommendations.recommendation_candidate (id);

ALTER TABLE tasks_recommendations.task
  ADD CONSTRAINT task_origin_recommendation_consistency_check CHECK (
    (source = 'suggested') = (origin_recommendation_id IS NOT NULL)
  );

-- Serves "the task this recommendation became" — the outcome-history
-- linkage P7-BE-01's exit evidence ("Priority and outcome history tests")
-- will read back.
CREATE INDEX task_origin_recommendation_id_idx
  ON tasks_recommendations.task (origin_recommendation_id)
  WHERE origin_recommendation_id IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE tasks_recommendations.task
  DROP CONSTRAINT IF EXISTS task_origin_recommendation_consistency_check,
  DROP COLUMN IF EXISTS origin_recommendation_id;

DROP TABLE IF EXISTS tasks_recommendations.recommendation_feedback CASCADE;
DROP TABLE IF EXISTS tasks_recommendations.recommendation_priority_factor CASCADE;
-- CASCADE here also removes recommendation_candidate's deferred
-- primary-evidence FK; the candidate table itself drops right after.
DROP TABLE IF EXISTS tasks_recommendations.recommendation_evidence CASCADE;
DROP TABLE IF EXISTS tasks_recommendations.recommendation_candidate CASCADE;
DROP TABLE IF EXISTS tasks_recommendations.rule_version CASCADE;

RESET ROLE;
