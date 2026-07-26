/**
 * Lists a garden's active professional assignments (P9B-API-01) — "who from
 * which organization can work on this garden." Gated by `viewGarden`, the
 * capability every garden role holds — the same "any household member may
 * see who else can see their own garden" reasoning `ListGardenMembers`
 * already applies. Organization membership plays no part in this gate: this
 * is a GARDEN read, authorized entirely through `GardenAuthorization`, the
 * ordinary garden-membership mechanism every other garden-scoped read in
 * this codebase already funnels through.
 */

import type { GardenAssignmentListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GardenAssignmentRepository } from './garden-assignment-repository.js';
import { toGardenAssignmentResource } from './garden-assignment-view.js';

export class ListGardenAssignmentsForGarden {
  constructor(
    private readonly assignments: GardenAssignmentRepository,
    private readonly gardenAuthorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<GardenAssignmentListResult> {
    await this.gardenAuthorization.requireCapability(gardenId, profileId, 'viewGarden');

    const items = await this.assignments.listActiveForGarden(gardenId);

    return { items: items.map(toGardenAssignmentResource) };
  }
}
