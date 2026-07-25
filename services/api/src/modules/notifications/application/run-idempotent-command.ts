/**
 * Module-local instance of the shared idempotent-command mechanism — the
 * same shape every sibling module carries (see
 * `tasks-recommendations/application/run-idempotent-command.ts`'s header
 * for why each module holds its own copy bound to its own unit of work
 * rather than importing another module's internal implementation).
 *
 * One nuance specific to this module: `UpdateNotificationPreferences`'
 * document write deliberately produces NO unique violations of its own —
 * its first-write insert is `ON CONFLICT DO NOTHING`, surfacing a
 * concurrent create as a clean revision mismatch — so the catch below
 * still only ever sees the idempotency record's own primary-key race,
 * keeping the original comment's reasoning true here too.
 *
 * Source: architecture/backend-modular-monolith.md, section "15. Idempotency".
 */

import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import type {
  NotificationsTransactionContext,
  NotificationsUnitOfWork,
} from './notifications-unit-of-work.js';

/** How long a completed command's result stays replayable. */
export const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function runIdempotentCommand<T>(
  idempotency: IdempotencyStore,
  unitOfWork: NotificationsUnitOfWork,
  input: IdempotencyRecordInput,
  responseStatusCode: number,
  work: (context: NotificationsTransactionContext) => Promise<T>,
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
