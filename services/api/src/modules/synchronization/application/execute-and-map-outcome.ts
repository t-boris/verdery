/**
 * Shared try/catch/map shape every per-record-family router uses to turn one
 * sibling-module command execution into a `SyncOperationOutcome`.
 *
 * The six push outcomes this pass has a real producer for versus not (see
 * this module's `public.ts` doc comment for the full account):
 *
 * - `accepted`: `work()` resolves normally.
 * - `conflict`: `StaleRevisionError` — the one error category every
 *   revision-guarded sibling command (`apply-revision-guarded-update.ts`,
 *   `apply-plant-revision-guarded-update.ts`,
 *   `apply-task-revision-guarded-update.ts`,
 *   `apply-map-object-revision-guarded-update.ts`) already raises on a
 *   stale `expectedRevision` — reserved strictly for that case, per section
 *   "14.2 Same Mutable Object": a `SyncConflictOperationResult` carries
 *   `currentRecord`, which is only meaningful when the client's expected
 *   revision itself is what disagreed with the server, not for an
 *   unrelated domain-rule failure that happens to also be called a
 *   "conflict" in prose (architecture/offline-synchronization.md, section
 *   "14.4 Task State": "completing a cancelled or superseded task returns a
 *   domain conflict" — that one is `DomainRuleViolatedError` today, mapped
 *   to `rejected` below, not `conflict`, precisely because there is no
 *   stale revision and therefore no `currentRecord` divergence to show).
 * - `rejected`: every other typed `ApplicationError` — validation,
 *   not-found, forbidden, and domain-rule violations alike. This is the
 *   overwhelmingly common case across all five record families.
 * - `retryLater`: `DependencyUnavailableError`. Wired and correct if this
 *   error is ever thrown, but **no command in this codebase throws it
 *   today** (confirmed by inspection — it exists in
 *   `platform/errors/application-error.ts` with zero call sites). This pass
 *   leaves it honestly unreachable rather than fabricating a scenario to
 *   exercise it.
 * - `duplicate`, `blockedByDependency`: decided one layer up, in
 *   `push-sync-operations.ts`/`order-sync-operations.ts` — never produced
 *   here.
 */

import type {
  SyncOperationError,
  SyncRecordReference,
  SyncRecordSnapshot,
} from '@verdery/api-contracts';
import {
  ApplicationError,
  DependencyUnavailableError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

function toRejected(error: ApplicationError): SyncOperationOutcome {
  const detail: SyncOperationError = {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: [...error.details] }),
  };
  return { kind: 'rejected', error: detail };
}

/**
 * Runs `work` (which invokes the routed sibling command and maps its result
 * into `SyncRecordReference[]`) and maps the outcome. `fetchCurrentRecord` is
 * `null` for record families with no revision to ever go stale (observation)
 * — see `route-observation-operation.ts`.
 */
export async function executeAndMapOutcome(
  work: () => Promise<readonly SyncRecordReference[]>,
  fetchCurrentRecord: (() => Promise<SyncRecordSnapshot>) | null,
): Promise<SyncOperationOutcome> {
  try {
    const recordRevisions = await work();
    return { kind: 'accepted', recordRevisions };
  } catch (error) {
    if (error instanceof StaleRevisionError) {
      if (fetchCurrentRecord === null) {
        return toRejected(error);
      }
      try {
        const currentRecord = await fetchCurrentRecord();
        return { kind: 'conflict', conflictCode: error.code, currentRecord };
      } catch {
        // The record changed again (or was concealed) between the stale
        // write and this follow-up read — an exceedingly narrow race. The
        // original stale-revision failure is still the honest, reportable
        // outcome; a `conflict` result with no `currentRecord` is not a
        // valid shape to send, so this falls back to `rejected` rather than
        // silently swallowing the second error or crashing the batch.
        return toRejected(error);
      }
    }

    if (error instanceof DependencyUnavailableError) {
      return { kind: 'retryLater', reason: error.code };
    }

    if (error instanceof ApplicationError) {
      return toRejected(error);
    }

    throw error;
  }
}
