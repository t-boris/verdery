/**
 * Lists an engagement's publisher grants (P9C-PUBLISH-01) — every grant,
 * active or revoked, newest first. Same dual authorization gate as
 * `GrantPublisherAccess`: only whoever administers the engagement may see
 * who currently holds publisher access on it.
 */

import type { PublisherGrantListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { toPublisherGrantResource } from './publisher-grant-view.js';
import type { PublisherGrantRepository } from './publisher-grant-repository.js';
import { requireEngagementCapability } from './require-engagement-capability.js';

export class ListPublisherGrantsForEngagement {
  constructor(
    private readonly grants: PublisherGrantRepository,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly engagements: ClientEngagementRepository,
  ) {}

  async execute(engagementId: Uuid, actorProfileId: Uuid): Promise<PublisherGrantListResult> {
    const engagement = await this.engagements.findById(engagementId);
    if (engagement === null) {
      throw engagementNotFoundError();
    }

    await requireEngagementCapability(
      engagement,
      actorProfileId,
      this.organizationAuthorization,
      this.gardenAuthorization,
    );

    const items = await this.grants.listForEngagement(engagementId);

    return { items: items.map(toPublisherGrantResource) };
  }
}
