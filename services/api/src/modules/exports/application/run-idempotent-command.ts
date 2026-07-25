/**
 * Module-local instance of the shared idempotent-command shape
 * (architecture/backend-modular-monolith.md section "15. Idempotency") —
 * the same "each module binds the pattern to its own unit of work" reasoning
 * `media/application/run-idempotent-command.ts` documents for why this is a
 * local copy rather than a cross-module import.
 *
 * ONE DIFFERENCE from the media copy, deliberate: a unique violation inside
 * `work` is NOT automatically assumed to be the idempotency record's own
 * primary key, because `RequestExport`'s transaction can also hit the
 * one-active-export partial unique index. After the replay re-check comes
 * back empty, the original error is rethrown for the CALLER to translate by
 * constraint name — never surfaced raw.
 */

import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import type { ExportsTransactionContext, ExportsUnitOfWork } from './exports-unit-of-work.js';

/** How long a completed command's result stays replayable — the shared figure. */
export const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function runIdempotentCommand<T>(
  idempotency: IdempotencyStore,
  unitOfWork: ExportsUnitOfWork,
  input: IdempotencyRecordInput,
  responseStatusCode: number,
  work: (context: ExportsTransactionContext) => Promise<T>,
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
