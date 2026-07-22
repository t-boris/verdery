/**
 * Shared shape for every gardens-mapping command handler: check for a prior
 * result before doing any work, run the work transactionally and save its
 * result, and recover cleanly from the rare true concurrent race `check`
 * cannot catch.
 *
 * Source: architecture/backend-modular-monolith.md, section "15. Idempotency".
 */

import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import type {
  GardensMappingTransactionContext,
  GardensMappingUnitOfWork,
} from './gardens-mapping-unit-of-work.js';

/** How long a completed command's result stays replayable. */
export const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function runIdempotentCommand<T>(
  idempotency: IdempotencyStore,
  unitOfWork: GardensMappingUnitOfWork,
  input: IdempotencyRecordInput,
  responseStatusCode: number,
  work: (context: GardensMappingTransactionContext) => Promise<T>,
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
    // In CreateGarden and the garden lifecycle commands, the only unique
    // constraint any statement in `work` can hit is the idempotency record's
    // own primary key — every other row `work` writes uses a freshly
    // generated UUIDv7 or is guarded by the capability check that already
    // ran. A true concurrent duplicate request lost the race to `save`; the
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
