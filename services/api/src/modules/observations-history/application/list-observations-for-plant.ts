import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ObservationRepository } from './observation-repository.js';
import { toObservationResource, type ObservationResource } from './observation-view.js';

/**
 * FR-23's chronological plant history: every observation recorded for one
 * plant, most recently observed first.
 *
 * Takes `gardenId` explicitly (not resolved internally from `plantId`) so
 * the capability check has a garden to check against without an extra
 * cross-module lookup for every read — the same choice `MapObjectRepository.
 * findById(gardenId, objectId)` already makes for a non-root entity.
 */
export class ListObservationsForPlant {
  constructor(
    private readonly observations: ObservationRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, plantId: Uuid, profileId: Uuid): Promise<ObservationResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const entries = await this.observations.listForPlant(gardenId, plantId);
    return entries.map(toObservationResource);
  }
}
