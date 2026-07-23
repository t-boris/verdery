/**
 * Dependency-aware processing order for one push batch.
 *
 * A real topological pass (Kahn's algorithm, run in waves), not an
 * approximation — chosen because the correctness guarantee section
 * "16. Ordering" and `SyncOperation.dependsOnOperationIds` describe
 * ("operations with no unmet `dependencyOperationIds` first... independent
 * operations should not be blocked by one failed command") is exactly what
 * a topological sort already gives for free, and the batch size this
 * contract bounds (`SyncPushRequest.operations`, `maxItems: 500`, each with
 * `dependsOnOperationIds`, `maxItems: 20`) is far too small for a simpler
 * approximation to be worth the correctness risk: this runs in at most
 * `operations.length` waves, each wave a single linear scan, so the whole
 * pass is bounded well under a second even at the maximum batch size.
 *
 * Two dependency scopes, resolved differently:
 *
 * - **Batch-local**: a `dependsOnOperationIds` entry naming another
 *   operation in this same batch. Its outcome is only known once that
 *   operation is itself decided — by definition, within an earlier wave (or
 *   this one, if it turns out to have no unresolved deps of its own) — so
 *   these edges are what actually drives the wave structure.
 * - **External**: an id from an earlier batch, "already accepted or not"
 *   is a fixed, already-durable fact this call cannot change — resolved
 *   once per unique id, up front, via `resolveExternal` (backed by
 *   `IdempotencyStore.lookup`, memoized by the caller), not through the
 *   wave algorithm.
 *
 * A dependency cycle confined entirely to this batch (impossible to satisfy
 * no matter the order) is detected the same way Kahn's algorithm always
 * detects one: when a wave makes no progress, every operation still
 * unresolved is part of, or depends on, a cycle, and is resolved as
 * `blockedByDependency` citing whichever of its own batch-local dependencies
 * are still unresolved at that point (the cycle's own members).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface DependencyAwareOperation {
  readonly operationId: Uuid;
  readonly dependsOnOperationIds: readonly Uuid[];
}

export interface OrderedProcessingResult<TResult> {
  readonly operationId: Uuid;
  readonly result: TResult;
}

export interface OrderSyncOperationsCallbacks<
  TOperation extends DependencyAwareOperation,
  TResult,
> {
  /** Whether a dependency id outside this batch already succeeded (`accepted`) in an earlier push. Called at most once per unique external id. */
  readonly resolveExternal: (dependencyOperationId: Uuid) => Promise<boolean>;
  /** Decides one operation's own outcome. Only called once every batch-local dependency it declared is itself already decided. */
  readonly process: (operation: TOperation) => Promise<TResult>;
  /** Builds the `blockedByDependency`-shaped result for an operation with at least one unmet dependency (batch-local, external, or a cycle member). */
  readonly toBlocked: (operation: TOperation, blockingOperationIds: readonly Uuid[]) => TResult;
  /** Whether a batch-local dependency's already-decided result counts as "succeeded" for downstream operations — true for `accepted`/`duplicate`. */
  readonly isSatisfied: (result: TResult) => boolean;
}

export async function orderAndProcessSyncOperations<
  TOperation extends DependencyAwareOperation,
  TResult,
>(
  operations: readonly TOperation[],
  callbacks: OrderSyncOperationsCallbacks<TOperation, TResult>,
): Promise<readonly OrderedProcessingResult<TResult>[]> {
  const batchLocalIds = new Set(operations.map((op) => op.operationId));
  const decided = new Map<Uuid, TResult>();

  const externalCache = new Map<Uuid, Promise<boolean>>();
  function resolveExternalCached(id: Uuid): Promise<boolean> {
    let cached = externalCache.get(id);
    if (cached === undefined) {
      cached = callbacks.resolveExternal(id);
      externalCache.set(id, cached);
    }
    return cached;
  }

  let remaining: TOperation[] = [...operations];

  while (remaining.length > 0) {
    const nextRemaining: TOperation[] = [];
    let progressed = false;

    for (const operation of remaining) {
      const batchLocalDeps = operation.dependsOnOperationIds.filter((id) => batchLocalIds.has(id));
      const unresolvedBatchLocal = batchLocalDeps.filter((id) => !decided.has(id));

      if (unresolvedBatchLocal.length > 0) {
        nextRemaining.push(operation);
        continue;
      }

      progressed = true;

      const failedBatchLocal = batchLocalDeps.filter(
        (id) => !callbacks.isSatisfied(decided.get(id) as TResult),
      );

      const externalDeps = operation.dependsOnOperationIds.filter((id) => !batchLocalIds.has(id));
      const failedExternal: Uuid[] = [];
      for (const id of externalDeps) {
        // Sequential, not `Promise.all`: batch size and dependency count are
        // both small and bounded, and sequential resolution keeps this
        // trivially deterministic to reason about and test.
        const satisfied = await resolveExternalCached(id);
        if (!satisfied) {
          failedExternal.push(id);
        }
      }

      const blockingOperationIds = [...failedBatchLocal, ...failedExternal];

      if (blockingOperationIds.length > 0) {
        decided.set(operation.operationId, callbacks.toBlocked(operation, blockingOperationIds));
      } else {
        // Sequential, not concurrent: each operation's own routed command
        // may itself write to the database; running these concurrently
        // would let independent operations race for connections/
        // transactions in ways this module has no need to reason about.
        // Sequential processing matches "the server processes operations in
        // dependency-aware order" (section "8. Push Protocol") literally,
        // not just its blocking guarantee.
        decided.set(operation.operationId, await callbacks.process(operation));
      }
    }

    if (!progressed) {
      // Every remaining operation is part of, or depends on, a batch-local
      // dependency cycle: no wave can ever resolve their remaining
      // unresolved batch-local dependencies, since resolving any of them
      // would have already let a prior iteration progress.
      for (const operation of remaining) {
        const batchLocalDeps = operation.dependsOnOperationIds.filter((id) =>
          batchLocalIds.has(id),
        );
        const unresolvedBatchLocal = batchLocalDeps.filter((id) => !decided.has(id));
        decided.set(operation.operationId, callbacks.toBlocked(operation, unresolvedBatchLocal));
      }
      break;
    }

    remaining = nextRemaining;
  }

  return operations.map((operation) => ({
    operationId: operation.operationId,
    result: decided.get(operation.operationId) as TResult,
  }));
}
