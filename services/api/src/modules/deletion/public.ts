/**
 * Public interface of the deletion module (P8-DELETE-01).
 *
 * The module owns the `deletion` schema (the purge job, which is also the
 * surviving completion evidence), the account-deletion command surface, and
 * the sweep that executes both halves of the purge after their recovery
 * windows close. Garden deletion REQUEST and RESTORE deliberately live in
 * `gardens-mapping` instead — they write only that module's own schemas, and
 * moving them here would have meant a cross-schema write for no gain.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  DeletionRecord,
  DeletionRecordState,
  DeletionSubjectType,
} from './domain/deletion-record.js';
export type {
  DeletionRecordRepository,
  PurgeCheckpoint,
} from './application/deletion-record-repository.js';
export type {
  DeletionTransactionContext,
  DeletionUnitOfWork,
} from './application/deletion-unit-of-work.js';
export type { PurgeExecutor } from './application/purge-executor.js';
export type { PurgePreparation, PurgeStep } from './application/purge-plan.js';
export {
  ACCOUNT_PURGE_PREPARATIONS,
  ACCOUNT_PURGE_STEPS,
  GARDEN_PURGE_PREPARATIONS,
  GARDEN_PURGE_STEPS,
} from './application/purge-plan.js';
export { GetAccountDeletion } from './application/get-account-deletion.js';
export { RequestAccountDeletion } from './application/request-account-deletion.js';
export { RestoreAccountDeletion } from './application/restore-account-deletion.js';
export { RunDeletionSweep } from './application/run-deletion-sweep.js';
export type { DeletionSweepResult } from './application/run-deletion-sweep.js';
export { RunPurge } from './application/run-purge.js';
export { KyselyDeletionRecordRepository } from './persistence/kysely-deletion-record-repository.js';
export { KyselyDeletionUnitOfWork } from './persistence/kysely-deletion-unit-of-work.js';
export { KyselyPurgeExecutor } from './persistence/kysely-purge-executor.js';
export type { DeletionDatabaseSchema } from './persistence/schema.js';
export { registerAccountDeletionRoutes } from './transport/account-deletion-routes.js';
export type { AccountDeletionRoutesDependencies } from './transport/account-deletion-routes.js';
export { registerDeletionSweepRoute } from './transport/deletion-sweep-route.js';
export type { DeletionSweepRouteDependencies } from './transport/deletion-sweep-route.js';
