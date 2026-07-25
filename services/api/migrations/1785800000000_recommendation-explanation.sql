-- Recommendation explanation storage (P7-BE-01).
--
-- P7-RULE-01's engine renders a deterministic explanation for every
-- candidate it plans ("Explanation facts" through the rule's own
-- `explanationTemplate`), but P7-DATA-01 deliberately stored no
-- explanation column — its migration's own header says why: "nothing this
-- stage builds can produce one, and the stage that can owns its shape."
-- The stage that can is the engine, and the stage that NEEDS the stored
-- text is this one: the Today surface must show FR-24's "Reason" for every
-- presented candidate, and the rendered text is a per-candidate
-- generation-time fact that cannot be reproduced later — the template's
-- placeholders resolve against evaluation-time facts (for example the
-- plant's display name and the day count at generation) that the evidence
-- rows do not fully snapshot, and re-rendering against CURRENT facts would
-- silently rewrite history ("Presentation does not overwrite generation
-- evidence", section 6, applies to the reason a user was shown). So the
-- rendered deterministic text is persisted at generation time, on the
-- candidate row it explains.
--
-- Deliberately NOT the section-10 AI explanation record: prompt-template
-- version, model and configuration version, generated text, and validation
-- outcome remain P7-AI-01's shape to own. This column is that record's
-- guaranteed-deterministic baseline ("If generation fails, the
-- deterministic explanation is shown") — the one piece Today cannot exist
-- without.
--
-- Nullable, default-free: NULL only on legacy rows created before this
-- migration (the `calibration` transform columns' own documented posture —
-- "NULL only on legacy P3-shaped rows"). Every candidate the engine
-- persists from this stage on carries the text. No backfill is possible or
-- attempted: the rendered text never existed for those rows, and inventing
-- one would violate the no-invention posture. Legacy rows also predate any
-- presentation surface (P7-BE-01 is the first), so none was ever shown to
-- a user; they drain naturally — superseded or expired by the scheduled
-- sweeps, both states the presentable-explanation CHECK below admits
-- without the text.
--
-- The same engine change that writes `explanation` also starts recording
-- the `generated -> eligible` transition at persistence time (the engine's
-- section-3 eligibility and safety filters have passed by the moment a
-- candidate is planned — P7-DATA-01's lifecycle comment names the engine
-- as exactly the decider this transition records). The CHECK ties the two
-- facts together physically: a candidate cannot be presentable (or carry a
-- presentable-lineage state) without its stored reason. Legacy 'generated'
-- rows can never reach 'eligible' — only the engine's own insert path
-- produces eligible candidates, always with the text — so the CHECK holds
-- for every row that can ever exist.
--
-- Source: implementation-plan.md work package P7-BE-01;
--         architecture/recommendations-and-ai.md, sections "6. Candidate
--         Lifecycle" and "10. Explanation Generation";
--         technical-specification.md, sections "FR-3: Today View" and
--         "FR-24: Recommendations".

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE tasks_recommendations.recommendation_candidate
  ADD COLUMN explanation text,
  -- Same non-blank posture as `care_category`: an empty reason explains
  -- nothing.
  ADD CONSTRAINT recommendation_candidate_explanation_not_blank_check CHECK (
    explanation IS NULL OR explanation <> ''
  ),
  -- One implication, matching the presentation-timestamp CHECK's style:
  -- the antecedent names exactly the states reachable only through the
  -- post-P7-BE-01 insert path ('eligible', and everything presentation
  -- leads to), which require the stored reason. 'generated', 'expired',
  -- 'superseded' — and any UNRECOGNIZED state — fall outside the
  -- antecedent and admit NULL: legacy pre-explanation rows rest in
  -- 'generated' and drain through the sweeps' expiry/supersession edges,
  -- and state VOCABULARY stays the state CHECK's single concern (an
  -- unknown state must fail that constraint alone, not this one too —
  -- the exact lesson P7-DATA-01's timestamp CHECK records).
  ADD CONSTRAINT recommendation_candidate_presentable_explanation_check CHECK (
    state NOT IN ('eligible', 'presented', 'completed', 'postponed', 'rejected')
    OR explanation IS NOT NULL
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE tasks_recommendations.recommendation_candidate
  DROP CONSTRAINT IF EXISTS recommendation_candidate_presentable_explanation_check,
  DROP CONSTRAINT IF EXISTS recommendation_candidate_explanation_not_blank_check,
  DROP COLUMN IF EXISTS explanation;

RESET ROLE;
