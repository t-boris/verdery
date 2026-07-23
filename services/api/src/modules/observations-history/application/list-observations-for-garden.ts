import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ObservationRepository } from './observation-repository.js';
import { toObservationResource, type ObservationResource } from './observation-view.js';

/** FR-23's chronological garden history: every observation recorded in the garden, most recently observed first. */
export class ListObservationsForGarden {
  constructor(
    private readonly observations: ObservationRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<ObservationResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const entries = await this.observations.listForGarden(gardenId);
    return entries.map(toObservationResource);
  }
}
