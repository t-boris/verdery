/**
 * The internal result shape every per-record-family router
 * (`route-garden-operation.ts` and its four siblings) produces, before
 * `push-sync-operations.ts` attaches `outcome`/`operationId` and decides
 * `accepted` versus `duplicate`.
 *
 * Deliberately narrower than `SyncPushOperationResult`: `blockedByDependency`
 * has no member here because that outcome is decided entirely by
 * `order-sync-operations.ts`, before a router is ever called — a router only
 * ever runs for an operation already known not to be blocked.
 */

import type {
  SyncOperationError,
  SyncRecordReference,
  SyncRecordSnapshot,
} from '@verdery/api-contracts';

export type SyncOperationOutcome =
  | { readonly kind: 'accepted'; readonly recordRevisions: readonly SyncRecordReference[] }
  | {
      readonly kind: 'conflict';
      readonly conflictCode: string;
      readonly currentRecord: SyncRecordSnapshot;
    }
  | { readonly kind: 'rejected'; readonly error: SyncOperationError }
  | {
      readonly kind: 'retryLater';
      readonly reason?: string;
      readonly retryAfterSeconds?: number;
    };
