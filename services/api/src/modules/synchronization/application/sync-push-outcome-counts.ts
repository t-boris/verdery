/**
 * Aggregate outcome counts for one `POST /sync/push` batch.
 *
 * Used only for structured logging: a count per outcome, never the
 * operations or payloads themselves — matching "Push accepted, duplicate,
 * rejected, and conflict rates" (architecture/observability-and-analytics.md,
 * section "7. Service Metrics" → "Synchronization") without recording any of
 * the "Prohibited Telemetry" that section 6 of the same document rules out.
 *
 * `retryLater` is counted the same as every other outcome even though no
 * command in this codebase throws `DependencyUnavailableError` today (see
 * `execute-and-map-outcome.ts`'s own header comment, "wired and correct if
 * this error is ever thrown... honestly unreachable") — this is not
 * fabricating a producer, only counting a wire outcome that already exists in
 * `SyncPushOperationResult`'s own type; the count is simply always `0` until
 * a producer exists.
 */

import type { SyncPushOperationResult } from '@verdery/api-contracts';

export interface SyncPushOutcomeCounts {
  readonly accepted: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly conflict: number;
  readonly blockedByDependency: number;
  readonly retryLater: number;
}

/** Counts one batch's `results` by outcome. Every entry increments exactly one count. */
export function countSyncPushOutcomes(
  results: readonly SyncPushOperationResult[],
): SyncPushOutcomeCounts {
  const counts: { -readonly [K in keyof SyncPushOutcomeCounts]: number } = {
    accepted: 0,
    duplicate: 0,
    rejected: 0,
    conflict: 0,
    blockedByDependency: 0,
    retryLater: 0,
  };

  for (const result of results) {
    counts[result.outcome] += 1;
  }

  return counts;
}
