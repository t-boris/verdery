/**
 * Returns a client update with its currently staged items (P9C-PUBLISH-01)
 * — the preview a publisher reviews before submitting. Publisher-only, the
 * same `requireClientUpdateAndAuthorize` gate every command in this family
 * shares.
 */

import type { ClientUpdate as ClientUpdateResource } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { ClientUpdateItemRepository } from './client-update-item-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import { toClientUpdateResource } from './client-update-view.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { requireClientUpdateAndAuthorize } from './require-client-update-and-authorize.js';

export class GetClientUpdate {
  constructor(
    private readonly engagements: ClientEngagementRepository,
    private readonly clientUpdates: ClientUpdateRepository,
    private readonly clientUpdateItems: ClientUpdateItemRepository,
    private readonly publisherAuthorization: PublisherAuthorization,
  ) {}

  async execute(
    engagementId: Uuid,
    clientUpdateId: Uuid,
    actorProfileId: Uuid,
  ): Promise<ClientUpdateResource> {
    const { clientUpdate } = await requireClientUpdateAndAuthorize(
      this.engagements,
      this.clientUpdates,
      this.publisherAuthorization,
      engagementId,
      clientUpdateId,
      actorProfileId,
    );

    const items = await this.clientUpdateItems.listForClientUpdate(clientUpdateId);

    return toClientUpdateResource(clientUpdate, items);
  }
}
