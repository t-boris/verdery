/**
 * Read-only listing of a plant's attached photos, scoped to a garden —
 * mirrors `GetPlantIdentification`'s own shape (authorize against the
 * path's own `gardenId` before any repository read, conceal "no such plant"
 * the same way).
 *
 * Added so a client can show the photo(s) `AddPlantFromPhoto`/
 * `AttachPlantPhoto` already attach — until this pass neither writing a
 * `plant_photo` row nor setting one primary exposed any way to read them
 * back as a set, only the single-photo `PlantResource`/`PlantPhotoResource`
 * each of those commands already returns for the one row it just touched.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listPlantPhotos`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { plantNotFoundError } from './plant-errors.js';
import type { PlantPhotoRepository } from './plant-photo-repository.js';
import { toPlantPhotoResource, type PlantPhotoResource } from './plant-photo-view.js';
import type { PlantRepository } from './plant-repository.js';

export class ListPlantPhotos {
  constructor(
    private readonly plants: PlantRepository,
    private readonly plantPhotos: PlantPhotoRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    plantId: Uuid,
    profileId: Uuid,
  ): Promise<readonly PlantPhotoResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const plant = await this.plants.findById(plantId);
    if (plant === null || plant.gardenId !== gardenId) {
      throw plantNotFoundError();
    }

    const photos = await this.plantPhotos.findAllForPlant(plantId);
    return photos.map(toPlantPhotoResource);
  }
}
