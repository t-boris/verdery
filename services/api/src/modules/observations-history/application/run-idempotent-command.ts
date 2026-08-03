/**
 * Shared shape for every observations-history command handler: check for a
 * prior result before doing any work, run the work transactionally and save
 * its result, and recover cleanly from the rare true concurrent race `check`
 * cannot catch.
 *
 * A module-local instance of the same mechanism gardens-mapping's own
 * `application/run-idempotent-command.ts` implements, the same way `media`
 * already made its own module-local copy
 * (`media/application/run-idempotent-command.ts`) rather than importing
 * gardens-mapping's: the pattern is shared architecture
 * (architecture/backend-modular-monolith.md, section "15. Idempotency"), but
 * its `unitOfWork`/`work` parameters are bound to this module's own
 * `ObservationsHistoryUnitOfWork`/`ObservationsHistoryTransactionContext`,
 * and gardens-mapping does not export its copy through `public.ts` — it is
 * an internal implementation detail of that module's own commands, so this
 * module cannot import it and instead follows the same shape locally.
 *
 * `RecordObservation` and `CorrectObservation` are still user-initiated,
 * idempotency-guarded commands even though `observation` itself carries no
 * `expectedRevision` to check — idempotency and "no revision guard" are
 * independent concerns: a retried request must still replay its first
 * result rather than recording the same observation twice, regardless of
 * whether the underlying table has a revision column at all.
 *
 * Source: architecture/backend-modular-monolith.md, section "15. Idempotency".
 */

import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from './observations-history-unit-of-work.js';

/** How long a completed command's result stays replayable. */
export const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function runIdempotentCommand<T>(
  idempotency: IdempotencyStore,
  unitOfWork: ObservationsHistoryUnitOfWork,
  input: IdempotencyRecordInput,
  responseStatusCode: number,
  work: (context: ObservationsHistoryTransactionContext) => Promise<T>,
): Promise<T> {
  const check = await idempotency.check(input);
  if (check.kind === 'replay') {
    return check.responseBody as T;
  }

  try {
    return await unitOfWork.run(async (context) => {
      const result = await work(context);
      await context.idempotency.save(
        input,
        responseStatusCode,
        result,
        IDEMPOTENCY_TTL_MILLISECONDS,
      );
      return result;
    });
  } catch (error) {
    // Every id `work` inserts is a freshly generated UUIDv7 and cannot
    // collide, so the unique violation this recovers from is the idempotency
    // record's own key: a true concurrent duplicate request lost the race to
    // `save`, and the winner's result, committed under the same key, is
    // authoritative.
    //
    // It is no longer the ONLY unique constraint reachable from here —
    // P11-MEDIA-01 added `observation_measurement_unique_kind` — which is why
    // the recheck below is what decides. A violation that is not a lost race
    // finds no replay and is rethrown rather than being reported as a
    // successful duplicate. Requests that would hit that constraint are
    // refused at the transport boundary (`parse-observation-request.ts`), so
    // reaching it here means a defect, not ordinary client input.
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const recheck = await idempotency.check(input);
    if (recheck.kind === 'replay') {
      return recheck.responseBody as T;
    }
    throw error;
  }
}
