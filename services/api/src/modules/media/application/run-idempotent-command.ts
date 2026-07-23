/**
 * Shared shape for media command handlers: check for a prior result before
 * doing any work, run the work transactionally and save its result, and
 * recover cleanly from the rare true concurrent race `check` cannot catch.
 *
 * A module-local instance of the same mechanism gardens-mapping's own
 * `application/run-idempotent-command.ts` implements: the pattern is shared
 * architecture (architecture/backend-modular-monolith.md, section
 * "15. Idempotency"), but its `unitOfWork`/`work` parameters are bound to
 * this module's own `MediaUnitOfWork`/`MediaTransactionContext`, and
 * gardens-mapping does not export its copy through `public.ts` — it is an
 * internal implementation detail of that module's own commands, so this
 * module cannot import it and instead follows the same shape locally.
 *
 * Source: architecture/backend-modular-monolith.md, section "15. Idempotency".
 */

import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import type { MediaTransactionContext, MediaUnitOfWork } from './media-unit-of-work.js';

/** How long a completed command's result stays replayable. */
export const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function runIdempotentCommand<T>(
  idempotency: IdempotencyStore,
  unitOfWork: MediaUnitOfWork,
  input: IdempotencyRecordInput,
  responseStatusCode: number,
  work: (context: MediaTransactionContext) => Promise<T>,
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
    // The only unique constraint any statement in `work` can hit is the
    // idempotency record's own primary key: `RegisterMediaRecord` always
    // writes a freshly generated UUIDv7 media id, which cannot collide. A
    // true concurrent duplicate request lost the race to `save`; the
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
