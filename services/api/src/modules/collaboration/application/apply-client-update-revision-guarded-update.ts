/**
 * `apply-task-revision-guarded-update.ts`'s counterpart for `client_update`:
 * fetch, check `expectedRevision`, transform, write back guarded by the
 * revision actually observed — the same pattern retargeted to
 * `ClientUpdateRepository`. Runs INSIDE the caller's own transaction (the
 * `context.clientUpdates` passed in is transaction-bound), so this is the
 * authoritative, freshest-possible read — never the same instance an
 * authorization check may have read earlier on the pooled connection.
 *
 * Source: architecture/api-design.md, section "7. Optimistic Concurrency".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import {
  clientUpdateNotFoundError,
  clientUpdateStaleRevisionError,
} from './client-update-errors.js';
import type { ClientUpdateDetail, ClientUpdateRepository } from './client-update-repository.js';

export async function applyClientUpdateRevisionGuardedUpdate(
  clientUpdates: ClientUpdateRepository,
  clientUpdateId: Uuid,
  expectedRevision: number,
  transform: (current: ClientUpdateDetail) => ClientUpdateDetail,
): Promise<ClientUpdateDetail> {
  const current = await clientUpdates.findById(clientUpdateId);
  if (current === null) {
    throw clientUpdateNotFoundError();
  }
  if (current.revision !== expectedRevision) {
    throw clientUpdateStaleRevisionError(current.revision);
  }

  const updated = transform(current);
  const applied = await clientUpdates.update(updated, current.revision);
  if (!applied) {
    throw clientUpdateStaleRevisionError(current.revision);
  }

  return updated;
}
