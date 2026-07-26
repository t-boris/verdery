/**
 * Lists a garden's client engagements (P9B-API-01). Owner-only
 * (`manageGarden`), unlike `ListGardenAssignmentsForGarden`'s `viewGarden` —
 * an engagement names a service-organization business relationship and
 * stewardship policy, the same sensitivity `listGardenInvitations` already
 * reserves to the owner alone (an invitation carries an intended email; an
 * engagement carries who is contracted to serve this garden and under what
 * data policy). Returns every engagement in any state, newest first.
 */

import type { ClientEngagementListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { toClientEngagementResource } from './client-engagement-view.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';

export class ListClientEngagementsForGarden {
  constructor(
    private readonly engagements: ClientEngagementRepository,
    private readonly gardenAuthorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<ClientEngagementListResult> {
    await this.gardenAuthorization.requireCapability(gardenId, profileId, 'manageGarden');

    const items = await this.engagements.listForGarden(gardenId);

    return { items: items.map(toClientEngagementResource) };
  }
}
