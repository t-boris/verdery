/**
 * The stable, typo-safe set of `platform.sync_change.record_type` values this
 * service writes.
 *
 * `record_type` carries no database `CHECK` constraint (unlike `operation`,
 * which does — see the migration's own `sync_change_operation_check`):
 * new modules are expected to onboard their own record types over time, and
 * a `CHECK` would need a migration per new module rather than a one-file
 * code review. This union is the safety net instead, mirroring the
 * `TaskErrorCode`-style const-object convention this codebase already uses
 * for a stable, closed vocabulary — see, for example,
 * `modules/tasks-recommendations/application/task-errors.ts`'s own
 * `TaskErrorCode`.
 *
 * Every module that writes `platform.sync_change` today is listed here.
 * Add a new member only when a module actually starts writing that type —
 * do not speculatively grow this list.
 *
 * Source: architecture/data-and-geospatial-design.md, section
 * "16. Synchronization Change Log"; architecture/offline-synchronization.md.
 */
export const SyncRecordType = {
  Garden: 'garden',
  GardenObject: 'gardenObject',
  Calibration: 'calibration',
  Plant: 'plant',
  Observation: 'observation',
  Task: 'task',
} as const;

export type SyncRecordType = (typeof SyncRecordType)[keyof typeof SyncRecordType];
