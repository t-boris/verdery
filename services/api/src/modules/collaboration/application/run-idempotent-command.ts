/**
 * Shared shape for every collaboration command handler: check for a prior
 * result before doing any work, run the work transactionally and save its
 * result, and recover cleanly from the rare true concurrent race `check`
 * cannot catch.
 *
 * A module-local instance of the same mechanism `gardens-mapping/application/
 * run-idempotent-command.ts` implements — the pattern is shared architecture
 * (architecture/backend-modular-monolith.md, section "15. Idempotency"), but
 * its `unitOfWork`/`work` parameters are bound to this module's own
 * `CollaborationUnitOfWork`/`CollaborationTransactionContext`, and
 * gardens-mapping does not export its copy through `public.ts` — the same
 * "module-local implementation detail" posture `media/application/
 * run-idempotent-command.ts`'s own header documents for the identical reuse
 * question.
 *
 * Source: architecture/backend-modular-monolith.md, section "15. Idempotency".
 */

import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import type {
  CollaborationTransactionContext,
  CollaborationUnitOfWork,
} from './collaboration-unit-of-work.js';

/** How long a completed command's result stays replayable. */
export const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function runIdempotentCommand<T>(
  idempotency: IdempotencyStore,
  unitOfWork: CollaborationUnitOfWork,
  input: IdempotencyRecordInput,
  responseStatusCode: number,
  work: (context: CollaborationTransactionContext) => Promise<T>,
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
    // Every unique constraint any statement in `work` can hit beyond the
    // idempotency record's own primary key is pre-checked (and, on the
    // genuine concurrent race, caught and translated) by the command itself
    // before this point — see `AddOrganizationMember`/`CreateGardenAssignment`'s
    // own dual pre-check-plus-catch handling. A true concurrent duplicate
    // request under the SAME idempotency key lost the race to `save`; the
    // winner's result, committed under the same key, is authoritative.
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
