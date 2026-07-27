/**
 * Lists an engagement's client updates, each with its currently staged
 * items, newest first (P9C-PUBLISH-01). Publisher-only.
 */

import type { ClientUpdateListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { ClientUpdateItemRepository } from './client-update-item-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import { toClientUpdateResource } from './client-update-view.js';
import type { PublisherAuthorization } from './publisher-authorization.js';

export class ListClientUpdatesForEngagement {
  constructor(
    private readonly engagements: ClientEngagementRepository,
    private readonly clientUpdates: ClientUpdateRepository,
    private readonly clientUpdateItems: ClientUpdateItemRepository,
    private readonly publisherAuthorization: PublisherAuthorization,
  ) {}

  async execute(engagementId: Uuid, actorProfileId: Uuid): Promise<ClientUpdateListResult> {
    const engagement = await this.engagements.findById(engagementId);
    if (engagement === null) {
      throw engagementNotFoundError();
    }

    await this.publisherAuthorization.requireActiveGrant(engagementId, actorProfileId);

    const updates = await this.clientUpdates.listForEngagement(engagementId);
    const items = await Promise.all(
      updates.map((update) => this.clientUpdateItems.listForClientUpdate(update.id)),
    );

    return {
      items: updates.map((update, index) => toClientUpdateResource(update, items[index] ?? [])),
    };
  }
}
