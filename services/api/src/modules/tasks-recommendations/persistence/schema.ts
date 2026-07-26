import type { Generated } from 'kysely';

/**
 * `due_date` is a `date` column, read as the raw `'YYYY-MM-DD'` string — see
 * `platform/database/pg-date-parser.ts` for why, and for the type parser
 * that makes this row type match what the driver actually returns, the same
 * convention `plants_inventory.plant`'s own `acquisition_date` documents.
 * `revision` is a plain `integer`, not `bigint` (only `task_revision`'s own
 * `sequence`/`revision` columns are `bigint`), so it reads back as a JS
 * number with no custom type parser needed — the identical note
 * `plants_inventory.plant`'s own `revision` column documents.
 */
export interface TaskRow {
  id: string;
  garden_id: string;
  target_kind: string;
  target_garden_area_id: string | null;
  target_plant_id: string | null;
  title: string;
  notes: string | null;
  status: Generated<string>;
  due_date: string | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  recurrence_rule: string | null;
  urgency: Generated<string>;
  source: Generated<string>;
  origin_observation_id: string | null;
  origin_recommendation_id: string | null;
  revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  completed_at: Date | null;
  /** P9A-TASK-01: `assigned_profile_id`/`assigned_at` present or absent together (`task_assignment_linkage_check`); `completed_by_profile_id` set only alongside `completed_at` (`task_completion_attribution_check`). All three reference `identity_access.profile`, never `collaboration.membership`, so attribution survives the profile losing garden access. */
  assigned_profile_id: string | null;
  assigned_at: Date | null;
  completed_by_profile_id: string | null;
}

export interface TaskAttachmentRow {
  id: string;
  task_id: string;
  media_id: string;
  created_at: Generated<Date>;
}

/**
 * Append-only journal: `sequence` is the physical insertion order, `revision`
 * is the task's own logical revision at the time this row was written —
 * structurally identical to `plants_inventory.plant_revision`. Both are
 * `bigint` in the migration, read as JS numbers via the global bigint type
 * parser (`platform/database/pg-bigint-parser.ts`) every integration test
 * that touches this table already imports.
 */
export interface TaskRevisionRow {
  sequence: Generated<number>;
  task_id: string;
  revision: number;
  command_type: string;
  status: string | null;
  due_date: string | null;
  /** P9A-TASK-01: populated only by an `assignTask` row — see `TaskRevisionJournalEntry.assignedProfileId`'s own doc comment. */
  assigned_profile_id: string | null;
  actor_profile_id: string;
  recorded_at: Generated<Date>;
}

/** Immutable versioned rule identity — see migrations/1785600000000_recommendations-baseline.sql for why this carries identity and safety tier only (rule catalog content is P7-RULE-01's). */
export interface RuleVersionRow {
  id: string;
  rule_key: string;
  version: number;
  safety_tier: string;
  created_at: Generated<Date>;
}

export interface RecommendationCandidateRow {
  id: string;
  garden_id: string;
  target_kind: string;
  target_garden_area_id: string | null;
  target_plant_id: string | null;
  care_category: string;
  /** The deterministic explanation rendered at generation time (P7-BE-01). `null` only on legacy rows predating 1785800000000_recommendation-explanation.sql — see that migration's header. */
  explanation: string | null;
  rule_version_id: string;
  safety_tier: string;
  state: Generated<string>;
  urgency: Generated<string>;
  window_start: Date | null;
  window_end: Date | null;
  primary_evidence_id: string;
  supersedes_candidate_id: string | null;
  presented_at: Date | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Append-only — "Presentation does not overwrite generation evidence"; no UPDATE path exists, like `observation`'s own rows. */
export interface RecommendationEvidenceRow {
  id: string;
  candidate_id: string;
  evidence_kind: string;
  source_observation_id: string | null;
  source_task_id: string | null;
  source_plant_id: string | null;
  source_weather_record_id: string | null;
  fact_key: string;
  fact_value: unknown;
  created_at: Generated<Date>;
}

export interface RecommendationPriorityFactorRow {
  id: string;
  candidate_id: string;
  factor_kind: string;
  factor_value: unknown;
  created_at: Generated<Date>;
}

/** Append-only user-feedback trail — see `recommendation-feedback.ts` for the FR-24 kind vocabulary and its pairing with the section-6 state vocabulary. */
export interface RecommendationFeedbackRow {
  id: string;
  candidate_id: string;
  feedback_kind: string;
  actor_profile_id: string;
  postponed_until: Date | null;
  recorded_at: Generated<Date>;
}

/**
 * Append-only per-(candidate, locale) AI-explanation verdicts (P7-AI-01) —
 * section 10's record: provenance versions, the packet's evidence
 * references, the generated text, and the validation outcome. See
 * migrations/1786100000000_recommendation-ai-explanation.sql.
 */
export interface RecommendationAiExplanationRow {
  id: string;
  candidate_id: string;
  locale: string;
  provider_key: string;
  model: string;
  prompt_template_version: number;
  packet_fact_keys: unknown;
  generated_text: string | null;
  validation_outcome: string;
  created_at: Generated<Date>;
}

export interface TasksRecommendationsDatabaseSchema {
  'tasks_recommendations.task': TaskRow;
  'tasks_recommendations.task_attachment': TaskAttachmentRow;
  'tasks_recommendations.task_revision': TaskRevisionRow;
  'tasks_recommendations.rule_version': RuleVersionRow;
  'tasks_recommendations.recommendation_candidate': RecommendationCandidateRow;
  'tasks_recommendations.recommendation_evidence': RecommendationEvidenceRow;
  'tasks_recommendations.recommendation_priority_factor': RecommendationPriorityFactorRow;
  'tasks_recommendations.recommendation_feedback': RecommendationFeedbackRow;
  'tasks_recommendations.recommendation_ai_explanation': RecommendationAiExplanationRow;
}
