/**
 * Public interface of the synchronization module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * This module is an *adapter*, not a sixth domain module: it owns no garden
 * content of its own (`platform.sync_client_installation` is the one table
 * it does own — see that migration's own comment for why it still lives in
 * `platform`'s schema). Every domain write a pushed operation causes is
 * performed by gardens-mapping's/plants-inventory's/observations-history's/
 * tasks-recommendations' own existing, unchanged command classes — this
 * module only translates a generic wire operation into the right one of
 * those thirty command calls and maps the result back onto the six push
 * outcomes. This is the same cross-module dependency shape
 * `tasks-recommendations` already established against its three Phase 4
 * siblings, extended to depend on all four business modules at once.
 *
 * P5-BE-01/P5-API-01 landed `PUT /v1/sync/clients/{id}`, `POST /v1/sync/push`,
 * and `POST /v1/sync/acknowledge`.
 *
 * P5-BE-02 (this pass) adds `GET /v1/sync/changes` on top of the same
 * module — new files inside `application/`/`transport/`/`persistence/`, not a
 * redesign of what came before. It reads `platform.sync_change` (Stage 1,
 * already landed) the same way the push side writes to it indirectly,
 * through the sibling modules' own commands. Initial synchronization, the
 * snapshot boundary, and full resynchronization are not separate mechanisms
 * or API surface — `GetSyncChanges`'s own header comment explains why the
 * single pull endpoint already expresses all three. Authorization revocation
 * is surfaced as an ordinary garden-tombstone row through the same endpoint;
 * see that same header comment for what is — and, honestly, is not —
 * currently wired for it (no command anywhere in this codebase revokes a
 * membership yet).
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  SyncClientInstallation,
  SyncClientPlatform,
} from './domain/sync-client-installation.js';

export type {
  RegisterOrRefreshInstallationInput,
  RegisterOrRefreshInstallationResult,
  SyncClientInstallationRepository,
} from './application/sync-client-installation-repository.js';
export { RegisterSyncClient } from './application/register-sync-client.js';
export type {
  RegisterSyncClientRequest,
  RegisterSyncClientResult,
} from './application/register-sync-client.js';
export {
  MIN_SUPPORTED_SYNC_PROTOCOL_VERSION,
  requireSupportedSyncProtocolVersion,
} from './application/sync-protocol-version.js';

export type { SyncOperationOutcome } from './application/sync-operation-outcome.js';
export type { GardenOperationRouterDependencies } from './application/route-garden-operation.js';
export type { GardenObjectOperationRouterDependencies } from './application/route-garden-object-operation.js';
export type { PlantOperationRouterDependencies } from './application/route-plant-operation.js';
export type { ObservationOperationRouterDependencies } from './application/route-observation-operation.js';
export type { TaskOperationRouterDependencies } from './application/route-task-operation.js';
export { SyncOperationRouter } from './application/sync-operation-router.js';
export type { SyncOperationRouterDependencies } from './application/sync-operation-router.js';

export {
  fingerprintOperationPayload,
  SYNC_PUSH_OPERATION,
  SYNC_PUSH_TTL_MILLISECONDS,
} from './application/sync-push-idempotency.js';
export { PushSyncOperations } from './application/push-sync-operations.js';
export { AcknowledgeSyncOperations } from './application/acknowledge-sync-operations.js';

export {
  SYNC_CHANGES_RETENTION_MILLISECONDS,
  decodeSyncChangesCursor,
  encodeSyncChangesCursor,
  requireFreshCursor,
} from './application/sync-changes-cursor.js';
export type { SyncChangesCursor } from './application/sync-changes-cursor.js';
export type {
  SyncChangeQuery,
  SyncChangeQueryInput,
  SyncChangeRecord,
} from './application/sync-change-query.js';
export { GetSyncChanges } from './application/get-sync-changes.js';
export type {
  GetSyncChangesRequest,
  SyncChangeRecordReaders,
} from './application/get-sync-changes.js';

export { KyselySyncClientInstallationRepository } from './persistence/kysely-sync-client-installation-repository.js';
export { KyselySyncChangeQuery } from './persistence/kysely-sync-change-query.js';

export { registerSyncRoutes } from './transport/sync-routes.js';
export type { SyncRoutesDependencies } from './transport/sync-routes.js';
