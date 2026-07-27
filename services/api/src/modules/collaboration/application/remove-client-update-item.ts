/**
 * Removes a staged item from a draft update (P9C-PUBLISH-01) —
 * `internal_draft` only, mirroring `AddClientUpdateItem`. Idempotent by
 * construction: a caller retrying the SAME idempotency key gets the same
 * replayed result; a genuinely repeated remove of an already-removed item
 * (a different key) gets a clean `404`, matching `ItemNotFound`'s own
 * concealment posture rather than a silent no-op — there is nothing left to
 * describe as "unchanged" once a row is gone.
 */

import type { ClientUpdateItem as ClientUpdateItemResource } from '@verdery/api-contracts';
import {
  clientUpdateContentLockedError,
  clientUpdateItemNotFoundError,
} from './client-update-errors.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { toClientUpdateItemResource } from './client-update-view.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { requireClientUpdateAndAuthorize } from './require-client-update-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.updates.items.remove';

export class RemoveClientUpdateItem {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly publisherAuthorization: PublisherAuthorization,
    private readonly engagements: ClientEngagementRepository,
    private readonly clientUpdates: ClientUpdateRepository,
  ) {}

  async execute(
    engagementId: Uuid,
    clientUpdateId: Uuid,
    itemId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<ClientUpdateItemResource> {
    const { clientUpdate } = await requireClientUpdateAndAuthorize(
      this.engagements,
      this.clientUpdates,
      this.publisherAuthorization,
      engagementId,
      clientUpdateId,
      actorProfileId,
    );

    if (clientUpdate.state !== 'internal_draft') {
      throw clientUpdateContentLockedError();
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, clientUpdateId, itemId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const item = await context.clientUpdateItems.findByIdAndClientUpdate(itemId, clientUpdateId);
      if (item === null) {
        throw clientUpdateItemNotFoundError();
      }

      await context.clientUpdateItems.remove(item.id);

      await context.auditLogger.record({
        eventType: 'client_update.item_removed',
        subjectType: 'client_update_item',
        subjectId: item.id,
        actorProfileId,
        actorType: 'user',
        gardenId: clientUpdate.gardenId,
        details: { engagementId, clientUpdateId, kind: item.kind },
      });
      await context.outbox.append({
        eventType: 'client_update.item_removed',
        aggregateType: 'client_update_item',
        aggregateId: item.id,
        payload: { engagementId, clientUpdateId, kind: item.kind },
      });

      return toClientUpdateItemResource(item);
    });
  }
}
