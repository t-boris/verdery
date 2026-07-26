/**
 * Lists every invitation ever issued for a garden, newest first (P9A-API-01).
 *
 * `manageGarden`, not `viewGarden` — unlike `ListGardenMembers`, whose entries
 * deliberately withhold email addresses, an invitation carries the intended
 * email itself. That is the enumeration surface `garden-capability-matrix.md`
 * reserves to the owner. Real, hitherto-missing use case this closes: the
 * only other way to find a pending invitation's id to revoke it was to have
 * retained the create response — impossible once a session ends.
 *
 * A pure read, not wrapped in the transactional unit of work, matching every
 * other query in this module.
 */

import type { InvitationListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { InvitationRepository } from './invitation-repository.js';
import { toInvitationResource } from './invitation-view.js';

export class ListGardenInvitations {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, actorProfileId: Uuid): Promise<InvitationListResult> {
    await this.authorization.requireCapability(gardenId, actorProfileId, 'manageGarden');

    const items = await this.invitations.listByGarden(gardenId);

    return { items: items.map(toInvitationResource) };
  }
}
