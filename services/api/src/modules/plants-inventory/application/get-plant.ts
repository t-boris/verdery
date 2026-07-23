/**
 * Read-only lookup for a single plant, scoped to a garden.
 *
 * Added for P4-CONTRACT-01's `GET /v1/gardens/{gardenId}/plants/{plantId}`
 * route: no existing command or query exposed `PlantRepository.findById`
 * both authorized and scoped to the garden path segment a REST route needs
 * — `requirePlantAndAuthorize` (used by every plant-scoped command) derives
 * `gardenId` from the plant row itself and never checks it against a
 * caller-supplied one, which is the right shape for a command that only
 * ever receives `plantId`, but not for a route whose URL already names the
 * garden.
 *
 * Mirrors `GetGarden`'s own shape: authorize first, against the path's own
 * `gardenId`, before any repository read (the same before-the-lookup
 * placement `GetGarden` uses); then fetch by id and conceal both "no such
 * plant" and "this plant belongs to a different garden" as the identical
 * `plantNotFoundError`, never distinguishing the two to an unauthorized
 * caller.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { plantNotFoundError } from './plant-errors.js';
import type { PlantRepository } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';

export class GetPlant {
  constructor(
    private readonly plants: PlantRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, plantId: Uuid, profileId: Uuid): Promise<PlantResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const plant = await this.plants.findById(plantId);
    if (plant === null || plant.gardenId !== gardenId) {
      throw plantNotFoundError();
    }

    return toPlantResource(plant);
  }
}
