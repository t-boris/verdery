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
  revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  completed_at: Date | null;
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
  actor_profile_id: string;
  recorded_at: Generated<Date>;
}

export interface TasksRecommendationsDatabaseSchema {
  'tasks_recommendations.task': TaskRow;
  'tasks_recommendations.task_attachment': TaskAttachmentRow;
  'tasks_recommendations.task_revision': TaskRevisionRow;
}
