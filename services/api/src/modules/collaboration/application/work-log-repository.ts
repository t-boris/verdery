import type { Uuid } from '../../../shared/identifiers/uuid.js';

/**
 * Mirrors `collaboration.work_log` exactly. Read-only port: nothing in
 * P9C-PUBLISH-01's own scope creates a `work_log` row (the migration's own
 * header already notes wiring `CompleteTask` to write one is out of that
 * package's scope, and no later work package in the plan table names it
 * either) — this module only needs to LIST the garden's existing work logs
 * for a publisher to select from (`ListEngagementWorkLogs`) and re-validate
 * a staged reference at publish time (`PublishClientUpdate` step 2). Test
 * fixtures seed rows directly against `collaboration.work_log`, the same
 * "raw insert, no repository method" posture every other fixture-only table
 * in this test suite already uses.
 */
export interface WorkLogDetail {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly assignmentId: Uuid | null;
  readonly taskId: Uuid | null;
  readonly actorProfileId: Uuid;
  readonly description: string;
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

export interface WorkLogRepository {
  findById(id: Uuid): Promise<WorkLogDetail | null>;

  /** A garden's work logs, most recently occurred first — the candidate list `ListEngagementWorkLogs`/`AddClientUpdateItem` both read from. */
  listForGarden(gardenId: Uuid): Promise<readonly WorkLogDetail[]>;
}
