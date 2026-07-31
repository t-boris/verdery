-- Health-suggestion safety extension (P11-HEALTH-01): additive columns on
-- `observations_history.image_analysis_result`, per ADR-0016 section 2
-- ("Health-suggestion safety") — this table IS the design doc's "health
-- suggestion" concept (plant-intelligence-and-visual-journal.md section 9),
-- extended in place rather than forked into a parallel
-- `plant_health_suggestion` table: same aggregate, same FK from
-- `observation_photo`, same P10/ADR-0015 write path
-- (`AnalyzePlantCondition` -> `attachObservationPhotos`).
--
-- Design doc section 9 names six fields a health suggestion carries beyond
-- what already existed (candidate issue, confidence, model version already
-- had `analysis_kind`/`suggested_label`/`confidence_score` since P4):
-- visible evidence summary, missing evidence and requested additional
-- views, alternative explanations, safety class, and a four-state user
-- disposition. This migration adds all of them, plus the model/prompt
-- version ADR-0016 section 2 names (`analyze-plant-condition.ts` already
-- computes `PlantConditionAnalysisProvenance { providerKey, model,
-- promptTemplateVersion }` per call today, but discards it after logging —
-- these two columns are where it is finally persisted).
--
-- `requested_view_purposes` reuses `observation_photo.purpose`'s own
-- 8-value vocabulary verbatim (P11-MEDIA-01,
-- migrations/1787900000000_visual-journal-observation-extensions.sql): the
-- design doc names "requested additional views" but never specifies their
-- shape, and this is the only existing closed vocabulary in the codebase
-- for "which view" a client can act on — a future client can literally
-- prompt "take another flower photo" from this list. Stored `jsonb`, not
-- `text[]`: `tasks_recommendations.recommendation_ai_explanation
-- .packet_fact_keys` is this codebase's own precedent for "a small string
-- array," and no table anywhere uses a native Postgres array column.
-- `alternative_explanations` (short candidate-label strings, not full
-- sentences) follows the identical `jsonb` array shape for the same
-- reason.
--
-- `safety_class` is a genuinely new vocabulary — neither the design doc nor
-- ADR-0016 defines its values. Chosen here as a three-step "how urgently
-- should the UI prompt a human follow-up" scale, deliberately NOT reusing
-- `tasks_recommendations.rule_version`'s `RecommendationSafetyTier`
-- (`ordinary_care`/`elevated_risk`/`restricted`): that vocabulary
-- classifies CARE ACTIONS a rule may recommend, not the urgency of an
-- unconfirmed AI diagnosis — a different axis, in a different domain. The
-- design doc's own cross-reference ("High-impact treatment recommendations
-- remain rules-first... under the recommendation safety policy") confirms
-- these stay two separate concepts: this column never authorizes a
-- treatment recommendation by itself.
--
-- `disposition` is the design doc's own closed, four-value vocabulary
-- verbatim: `confirmed_externally` (the user verified this elsewhere, e.g.
-- with a nursery or expert), `accepted_as_observation` (the user accepts
-- the suggestion as a plausible, unverified note on the record),
-- `rejected`, and `unresolved` (the default — no disposition has been
-- recorded yet). No ordering/transition constraint is enforced: the same
-- "any transition is a legitimate, if inert, command" posture
-- `plant-lifecycle.ts`'s own header already documents for `LifecycleStage`
-- applies here — a user may reconsider a disposition freely.
-- `disposition_set_at`/`disposition_set_by_profile_id` are both NULL
-- exactly when `disposition = 'unresolved'` and both set otherwise — the
-- same "implication CHECK" idiom this codebase's other provenance-linkage
-- constraints already use (e.g. `garden_context_fact_source_reviewed
-- _linkage_check`).
--
-- `requires_confirmation` (P4) and the structural absence of any
-- toxicity/edibility/pesticide/treatment/regulatory column are UNCHANGED
-- and untouched by this migration — the safety invariant this table has
-- carried since P4 stays intact; nothing added here narrows or reopens it.
--
-- Source: implementation-plan.md work package P11-HEALTH-01;
--         architecture/plant-intelligence-and-visual-journal.md, section
--         "9. Health Suggestions";
--         architecture/decisions/ADR-0016-phase-11-plant-intelligence
--         -domain-and-providers.md, section 2.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE observations_history.image_analysis_result
  ADD COLUMN model_name text,
  ADD COLUMN prompt_version integer,
  ADD COLUMN evidence_summary text NOT NULL DEFAULT '',
  ADD COLUMN alternative_explanations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN requested_view_purposes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN safety_class text NOT NULL DEFAULT 'informational',
  ADD COLUMN disposition text NOT NULL DEFAULT 'unresolved',
  ADD COLUMN disposition_set_at timestamptz,
  ADD COLUMN disposition_set_by_profile_id uuid REFERENCES identity_access.profile (id);

ALTER TABLE observations_history.image_analysis_result
  ADD CONSTRAINT image_analysis_result_model_name_check CHECK (
    model_name IS NULL OR model_name <> ''
  ),
  ADD CONSTRAINT image_analysis_result_prompt_version_check CHECK (
    prompt_version IS NULL OR prompt_version >= 1
  ),
  ADD CONSTRAINT image_analysis_result_alternative_explanations_check CHECK (
    jsonb_typeof(alternative_explanations) = 'array'
  ),
  -- `<@` is jsonb containment, not a subquery (CHECK constraints cannot
  -- contain one): "is the left array's element set a subset of the
  -- right's" — exactly the "every requested purpose is one of the 8
  -- documented values" test, order- and duplicate-independent.
  ADD CONSTRAINT image_analysis_result_requested_view_purposes_check CHECK (
    jsonb_typeof(requested_view_purposes) = 'array'
    AND requested_view_purposes <@
      '["whole_plant", "leaf_front", "leaf_back", "stem_or_bark", "flower", "fruit", "symptom_close_up", "context_or_free_form"]'::jsonb
  ),
  ADD CONSTRAINT image_analysis_result_safety_class_check CHECK (
    safety_class IN ('informational', 'monitor', 'expert_review_recommended')
  ),
  ADD CONSTRAINT image_analysis_result_disposition_check CHECK (
    disposition IN ('confirmed_externally', 'accepted_as_observation', 'rejected', 'unresolved')
  ),
  ADD CONSTRAINT image_analysis_result_disposition_set_at_linkage_check CHECK (
    (disposition = 'unresolved') = (disposition_set_at IS NULL)
  ),
  ADD CONSTRAINT image_analysis_result_disposition_set_by_linkage_check CHECK (
    (disposition = 'unresolved') = (disposition_set_by_profile_id IS NULL)
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE observations_history.image_analysis_result
  DROP CONSTRAINT image_analysis_result_disposition_set_by_linkage_check,
  DROP CONSTRAINT image_analysis_result_disposition_set_at_linkage_check,
  DROP CONSTRAINT image_analysis_result_disposition_check,
  DROP CONSTRAINT image_analysis_result_safety_class_check,
  DROP CONSTRAINT image_analysis_result_requested_view_purposes_check,
  DROP CONSTRAINT image_analysis_result_alternative_explanations_check,
  DROP CONSTRAINT image_analysis_result_prompt_version_check,
  DROP CONSTRAINT image_analysis_result_model_name_check;

ALTER TABLE observations_history.image_analysis_result
  DROP COLUMN disposition_set_by_profile_id,
  DROP COLUMN disposition_set_at,
  DROP COLUMN disposition,
  DROP COLUMN safety_class,
  DROP COLUMN requested_view_purposes,
  DROP COLUMN alternative_explanations,
  DROP COLUMN evidence_summary,
  DROP COLUMN prompt_version,
  DROP COLUMN model_name;

RESET ROLE;
