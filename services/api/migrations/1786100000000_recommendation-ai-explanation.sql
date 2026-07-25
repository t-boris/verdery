-- AI-explanation records (P7-AI-01): recommendations-and-ai.md section
-- 10's "final record", the shape P7-DATA-01 and P7-BE-01 both explicitly
-- left to this stage ("prompt-template version, model and configuration
-- version, generated text, and validation outcome remain P7-AI-01's
-- shape to own"). One append-only row per (candidate, locale) records
-- one bounded-generation attempt's verdict: the provenance versions
-- evaluation replays by (section 18's "Model-version replay and audit"),
-- the evidence references actually sent (fact keys — the minimal
-- packet's stable identifiers), the generated text, and the validation
-- outcome. The FALLBACK deterministic text is deliberately NOT
-- duplicated here: it is `recommendation_candidate.explanation`, always
-- present on every embellishable candidate, and the record reaches it
-- through `candidate_id` — one authoritative copy, never two that could
-- drift.
--
-- Append-only verdicts, at most one per (candidate, locale): a candidate
-- is generated once and its embellishment attempt is a fact about that
-- generation. TRANSIENT provider failures (timeout, outage, exhausted
-- budget) write NO row — "Calls retry only for safe transient outcomes"
-- (section 14) — so absence doubles as the retry marker; every durable
-- verdict (accepted or any rejection) closes the candidate's attempt
-- permanently. The UNIQUE index below is what converges concurrent
-- sweep runs to one row (`ON CONFLICT DO NOTHING` in the repository).
--
-- `validation_outcome` is a closed CHECK (the `evidence_kind` posture,
-- not the open `notification_intent.intent_type` one): the vocabulary is
-- section 9's own rejection list plus the two provider-side verdicts,
-- owned by this module's domain code, and no client renders it — a new
-- outcome arrives with the code that produces it and a migration
-- widening this list, loudly.
--
-- Only ACCEPTED rows are ever served (`accepted` requires its text, the
-- implication CHECK below); rejected rows keep their draft text for
-- section 16's evaluation, under the same deletion/retention obligations
-- as every stored AI artifact (section 15) — content lives HERE, in a
-- retained table, never in logs.
--
-- Grants: `verdery_application` gains row access automatically through
-- the platform baseline's ALTER DEFAULT PRIVILEGES loop for module
-- schemas. `verdery_worker` deliberately gets NOTHING: the embellishment
-- phase runs inside `services/api`'s sweep endpoint (the P7-ASYNC-01
-- privilege reasoning), and the relay never touches this table.
--
-- Source: implementation-plan.md work package P7-AI-01;
--         architecture/recommendations-and-ai.md, sections
--         "9. Structured Output", "10. Explanation Generation",
--         "14. Provider Failure", "15. Privacy", "16. Evaluation and
--         Release", "17. Observability";
--         ADR-0008-rules-first-recommendations-and-vertex-ai.md.

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE tasks_recommendations.recommendation_ai_explanation (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES tasks_recommendations.recommendation_candidate (id),
  -- The two product languages — section 16's "Russian and English
  -- quality evaluation" names exactly these.
  locale text NOT NULL,
  provider_key text NOT NULL,
  model text NOT NULL,
  prompt_template_version integer NOT NULL,
  -- The fact keys of the minimal evidence packet sent to the model —
  -- section 10's "Evidence references", stored as a jsonb string array.
  packet_fact_keys jsonb NOT NULL,
  generated_text text,
  validation_outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_ai_explanation_locale_check CHECK (
    locale IN ('en', 'ru')
  ),
  CONSTRAINT recommendation_ai_explanation_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT recommendation_ai_explanation_model_check CHECK (model <> ''),
  CONSTRAINT recommendation_ai_explanation_prompt_version_check CHECK (
    prompt_template_version >= 1
  ),
  -- A non-empty array: an evidence-free packet cannot exist (section
  -- 19's evidence invariant applies to what was SENT too).
  CONSTRAINT recommendation_ai_explanation_packet_check CHECK (
    jsonb_typeof(packet_fact_keys) = 'array' AND jsonb_array_length(packet_fact_keys) > 0
  ),
  CONSTRAINT recommendation_ai_explanation_text_not_blank_check CHECK (
    generated_text IS NULL OR generated_text <> ''
  ),
  CONSTRAINT recommendation_ai_explanation_outcome_check CHECK (validation_outcome IN (
    'accepted', 'schema_invalid', 'provider_safety_blocked', 'unknown_evidence_reference',
    'unsupported_action', 'unsupported_fact', 'prohibited_content', 'length_exceeded'
  )),
  -- One implication, the presentable-explanation CHECK's style: only the
  -- servable outcome requires its text; every other outcome may or may
  -- not carry a draft (a safety block has none, a rejected draft keeps
  -- its text for evaluation).
  CONSTRAINT recommendation_ai_explanation_accepted_text_check CHECK (
    validation_outcome <> 'accepted' OR generated_text IS NOT NULL
  )
);

-- At most one verdict per (candidate, locale) — see the header: this
-- index is what makes concurrent embellishment runs converge instead of
-- duplicating.
CREATE UNIQUE INDEX recommendation_ai_explanation_candidate_locale_key
  ON tasks_recommendations.recommendation_ai_explanation (candidate_id, locale);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE tasks_recommendations.recommendation_ai_explanation;

RESET ROLE;
