import type { Garden as GardenResource } from '@verdery/api-contracts';
import { GardenErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardenRepository } from './garden-repository.js';
import { toGardenResource } from './garden-view.js';

export class GetGarden {
  constructor(
    private readonly gardens: GardenRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<GardenResource> {
    const membership = await this.authorization.requireCapability(
      gardenId,
      profileId,
      'viewGarden',
    );

    const garden = await this.gardens.findById(gardenId);
    if (garden === null) {
      // The membership row referenced a garden that no longer exists — not
      // reachable via any Phase 2 endpoint (nothing deletes a garden row
      // outright yet), but a concealed-existence 404 is still the correct
      // response if it ever happened, not a 500.
      throw new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.');
    }

    return toGardenResource(garden, membership.role);
  }
}
