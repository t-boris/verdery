/**
 * `POST /v1/sync/push` — processes one bounded batch of client outbox
 * operations and returns one result per operation, in request order.
 *
 * Processing has two layers, run in this order for every operation:
 *
 * 1. **Operation-id idempotency** (`sync-push-idempotency.ts`): does this
 *    exact `operationId` already have a durable outcome? A replayed
 *    `accepted` becomes `duplicate` (no domain command re-runs — proven by
 *    this layer never calling the router for a replay); a replayed
 *    `rejected`/`conflict` replays unchanged; a reused id with a different
 *    payload becomes `rejected` with `request.idempotency.key_reused`,
 *    without touching the original stored record.
 * 2. **Dependency-aware ordering** (`order-sync-operations.ts`): only for an
 *    operation with no durable outcome yet. An operation whose
 *    `dependsOnOperationIds` includes one that did not (yet) succeed —
 *    inside this batch or an earlier one — becomes `blockedByDependency`
 *    without ever reaching the router.
 *
 * Everything that reaches the router is routed
 * (`sync-operation-router.ts`), mapped to a `SyncOperationOutcome`
 * (`execute-and-map-outcome.ts`), and — for the two durable outcomes
 * `accepted`/`rejected`/`conflict` reach — persisted via
 * `IdempotencyStore.save()` **immediately after** the routed command's own
 * transaction has already committed, not inside it.
 *
 * This is a **documented compromise, not an oversight**: every sibling
 * command already manages its own transaction internally (`runIdempotentCommand`
 * + each module's own `UnitOfWork` — see, for example,
 * `gardens-mapping/application/create-garden.ts`), and this module has no
 * access to that transaction from the outside — extending every sibling
 * module's unit-of-work to accept an externally-supplied, cross-module sync
 * idempotency write would be exactly the kind of architecture change this
 * repository's rules require approval for, not a routine addition. The
 * practical exposure is narrow: if the process crashes between a routed
 * command's commit and this module's own `save()`, the operation is
 * genuinely `accepted` (or `rejected`/`conflict`) server-side, but a retry
 * with the same operation ID would see `check()` return `'new'` again and
 * re-attempt it — which is safe for a create/update command guarded by its
 * own `expectedRevision`/internal idempotency key (reused as this router's
 * `idempotencyKey` — see `route-garden-operation.ts`'s header comment), just
 * not free (`accepted` may be delivered a second time as an ordinary
 * `duplicate`-shaped retry rather than a true no-op skip). No mutation is
 * ever double-applied; at worst the *sync-level* bookkeeping of "already
 * told the client" is redone once.
 */

import type {
  SyncBlockedByDependencyOperationResult,
  SyncOperation,
  SyncPushOperationResult,
  SyncPushRequest,
  SyncPushResult,
} from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import { ConflictError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { DependencyAwareOperation } from './order-sync-operations.js';
import { orderAndProcessSyncOperations } from './order-sync-operations.js';
import {
  fingerprintOperationPayload,
  SYNC_PUSH_OPERATION,
  SYNC_PUSH_TTL_MILLISECONDS,
} from './sync-push-idempotency.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';
import type { SyncOperationRouter } from './sync-operation-router.js';
import { requireSupportedSyncProtocolVersion } from './sync-protocol-version.js';

interface OrderableOperation extends DependencyAwareOperation {
  readonly operation: SyncOperation;
}

function toWireResult(operationId: Uuid, outcome: SyncOperationOutcome): SyncPushOperationResult {
  switch (outcome.kind) {
    case 'accepted':
      return { outcome: 'accepted', operationId, recordRevisions: [...outcome.recordRevisions] };
    case 'conflict':
      return {
        outcome: 'conflict',
        operationId,
        conflictCode: outcome.conflictCode,
        currentRecord: outcome.currentRecord,
      };
    case 'rejected':
      return { outcome: 'rejected', operationId, error: outcome.error };
    case 'retryLater':
      return {
        outcome: 'retryLater',
        operationId,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        ...(outcome.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: outcome.retryAfterSeconds }),
      };
  }
}

/** Only `accepted`, `rejected`, and `conflict` are durable — see this file's own header comment and `sync-push-idempotency.ts`. */
function isDurable(result: SyncPushOperationResult): boolean {
  return (
    result.outcome === 'accepted' || result.outcome === 'rejected' || result.outcome === 'conflict'
  );
}

/** A replayed `accepted` reports as `duplicate`; every other stored outcome replays unchanged. */
function toReplayResult(stored: SyncPushOperationResult): SyncPushOperationResult {
  if (stored.outcome === 'accepted') {
    return {
      outcome: 'duplicate',
      operationId: stored.operationId,
      recordRevisions: stored.recordRevisions,
    };
  }
  return stored;
}

function toBlockedResult(
  operationId: Uuid,
  blockingOperationIds: readonly Uuid[],
): SyncBlockedByDependencyOperationResult {
  return {
    outcome: 'blockedByDependency',
    operationId,
    blockingOperationIds: [...blockingOperationIds],
  };
}

export class PushSyncOperations {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly router: SyncOperationRouter,
  ) {}

  async execute(profileId: Uuid, request: SyncPushRequest): Promise<SyncPushResult> {
    // The OpenAPI operation's own `409` response documents
    // `sync.protocol_version.unsupported` for push, identically to
    // `GetSyncChanges`'s own check below it — this call was missing
    // entirely until found while verifying P5-OBS-01's new protocol-version
    // logging, which is what makes an unsupported version visible at all
    // now that it is actually rejected instead of silently processed.
    requireSupportedSyncProtocolVersion(request.protocolVersion);

    // Phase 1: resolve every operation's own durable outcome, if any, before
    // any dependency evaluation — an operation already durably decided
    // (in this batch's own idempotency store, from a prior push) needs no
    // dependency wait at all; see this module's own header comment.
    const preDecided = new Map<Uuid, SyncPushOperationResult>();

    for (const operation of request.operations) {
      const fingerprint = fingerprintOperationPayload(operation.payload);
      try {
        // One row lookup per operation, sequential: batch size is bounded
        // (max 500) and this must resolve before dependency ordering, which
        // needs every result up front.
        const check = await this.idempotency.check({
          actorProfileId: profileId,
          operation: SYNC_PUSH_OPERATION,
          idempotencyKey: operation.operationId,
          requestFingerprint: fingerprint,
        });
        if (check.kind === 'replay') {
          preDecided.set(
            operation.operationId,
            toReplayResult(check.responseBody as SyncPushOperationResult),
          );
        }
      } catch (error) {
        if (error instanceof ConflictError) {
          // Reused operation ID, different payload (section "9. Server
          // Idempotency") — rejected without touching the original stored
          // record. Intentionally not persisted via `save()`: the original,
          // valid record remains the durable truth for this operation ID.
          preDecided.set(operation.operationId, {
            outcome: 'rejected',
            operationId: operation.operationId,
            error: { code: SharedErrorCode.IdempotencyKeyReused, message: error.message },
          });
          continue;
        }
        throw error;
      }
    }

    // Operations already durably decided get an empty dependency list for
    // ordering purposes — their answer does not depend on anything else in
    // this batch, regardless of what they themselves declare (see this
    // module's own header comment for why this sidesteps a spurious wait).
    const orderable: OrderableOperation[] = request.operations.map((operation) => ({
      operationId: operation.operationId,
      dependsOnOperationIds: preDecided.has(operation.operationId)
        ? []
        : (operation.dependsOnOperationIds ?? []),
      operation,
    }));

    const externalLookupCache = new Map<Uuid, Promise<boolean>>();
    const resolveExternal = async (dependencyOperationId: Uuid): Promise<boolean> => {
      let cached = externalLookupCache.get(dependencyOperationId);
      if (cached === undefined) {
        cached = this.idempotency
          .lookup(profileId, SYNC_PUSH_OPERATION, dependencyOperationId)
          .then(
            (stored) =>
              stored !== null &&
              (stored.responseBody as SyncPushOperationResult).outcome === 'accepted',
          );
        externalLookupCache.set(dependencyOperationId, cached);
      }
      return cached;
    };

    const ordered = await orderAndProcessSyncOperations<
      OrderableOperation,
      SyncPushOperationResult
    >(orderable, {
      resolveExternal,
      isSatisfied: (result) => result.outcome === 'accepted' || result.outcome === 'duplicate',
      toBlocked: (operation, blockingOperationIds) =>
        toBlockedResult(operation.operationId, blockingOperationIds),
      process: async (operation) => {
        const already = preDecided.get(operation.operationId);
        if (already !== undefined) {
          return already;
        }

        const outcome = await this.router.route(
          profileId,
          operation.operationId,
          operation.operation.payload,
        );
        const result = toWireResult(operation.operationId, outcome);

        if (isDurable(result)) {
          await this.idempotency.save(
            {
              actorProfileId: profileId,
              operation: SYNC_PUSH_OPERATION,
              idempotencyKey: operation.operationId,
              requestFingerprint: fingerprintOperationPayload(operation.operation.payload),
            },
            200,
            result,
            SYNC_PUSH_TTL_MILLISECONDS,
          );
        }

        return result;
      },
    });

    return { results: ordered.map((entry) => entry.result) };
  }
}
