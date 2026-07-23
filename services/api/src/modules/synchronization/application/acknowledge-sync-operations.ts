/**
 * `POST /v1/sync/acknowledge` — pure lookup of already-decided durable
 * outcomes by operation id, against the exact same idempotency-by-operationId
 * store `PushSyncOperations` writes through (`sync-push-idempotency.ts`).
 *
 * No payload to check a fingerprint against and no new mutation — per the
 * OpenAPI operation's own description, this "performs no new mutation and
 * takes no `Idempotency-Key` — it only reports previously decided outcomes."
 * `IdempotencyStore.lookup()` (the additive method this module needed —
 * see `sync-push-idempotency.ts`'s own doc comment) is exactly this: a
 * fingerprint-independent read.
 *
 * The stored value is returned **unchanged**, never `accepted`-to-`duplicate`
 * transformed the way a `PushSyncOperations` replay is: that transformation
 * specifically distinguishes "this is a repeated *push* of an
 * already-accepted operation" from "this is the first push," a distinction
 * only meaningful when a push is actually being attempted. Acknowledge never
 * attempts anything — it reports "what did you decide," so the literal
 * decided value (`accepted`, `rejected`, or `conflict` — the only three
 * outcomes ever durably stored, see `sync-push-idempotency.ts`) is the
 * correct answer.
 *
 * An operation id with nothing stored — never pushed, or (once a retention
 * policy exists) expired — reports `unknown`, per the OpenAPI operation's own
 * description; the client's only recourse is a real `PushSyncOperations`
 * retry with the full canonical payload.
 */

import type {
  SyncAcknowledgeRequest,
  SyncAcknowledgeResult,
  SyncOperationLookupResult,
  SyncPushOperationResult,
} from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { SYNC_PUSH_OPERATION } from './sync-push-idempotency.js';

export class AcknowledgeSyncOperations {
  constructor(private readonly idempotency: IdempotencyStore) {}

  async execute(profileId: Uuid, request: SyncAcknowledgeRequest): Promise<SyncAcknowledgeResult> {
    const results: SyncOperationLookupResult[] = [];

    for (const operationId of request.operationIds) {
      // One row lookup per requested operation id, sequential: batch size is
      // bounded (max 500) and results must preserve request order.
      const stored = await this.idempotency.lookup(profileId, SYNC_PUSH_OPERATION, operationId);

      results.push(
        stored === null
          ? { outcome: 'unknown', operationId }
          : (stored.responseBody as SyncPushOperationResult),
      );
    }

    return { results };
  }
}
