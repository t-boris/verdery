/**
 * Lists an engagement's client access grants (P9C-INVITE-01) — every grant,
 * in any state, newest first. Same dual authorization gate as
 * `CreateClientInvitation`/`RevokeClientInvitation`: only whoever
 * administers the engagement may see who has been invited to it, mirroring
 * `ListPublisherGrantsForEngagement`'s identical shape for the sibling
 * capability.
 */

import type { ClientAccessGrantListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ClientAccessGrantRepository } from './client-access-grant-repository.js';
import { toClientAccessGrantResource } from './client-access-grant-view.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { requireEngagementCapability } from './require-engagement-capability.js';

export class ListClientInvitationsForEngagement {
  constructor(
    private readonly grants: ClientAccessGrantRepository,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly engagements: ClientEngagementRepository,
  ) {}

  async execute(engagementId: Uuid, actorProfileId: Uuid): Promise<ClientAccessGrantListResult> {
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

    return { items: items.map(toClientAccessGrantResource) };
  }
}
