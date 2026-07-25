import type { Generated } from 'kysely';

/** Mirrors `deletion.deletion_record` in 1786400000000_deletion-baseline.sql. */
export interface DeletionRecordRow {
  id: string;
  subject_type: string;
  subject_id: string;
  requested_by_profile_id: string;
  state: Generated<string>;
  requested_at: Date;
  recovery_deadline_at: Date;
  purge_started_at: Date;
  completed_at: Date | null;
  attempt_count: Generated<number>;
  deferred_reason: string | null;
  media_records_scheduled: Generated<number>;
  identity_provider_deleted_at: Date | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Mirrors `deletion.purge_checkpoint` — the resume point and the per-step evidence in one row. */
export interface PurgeCheckpointRow {
  deletion_id: string;
  step_name: string;
  // A JS number would be wrong here in principle (bigint) but right in
  // practice for the same reason every other bigint in this codebase is
  // parsed as a number: a per-step deleted-row count for one garden cannot
  // approach 2^53. See platform/database/pg-bigint-parser.ts.
  rows_deleted: number;
  completed_at: Date;
}

export interface DeletionDatabaseSchema {
  'deletion.deletion_record': DeletionRecordRow;
  'deletion.purge_checkpoint': PurgeCheckpointRow;
}
