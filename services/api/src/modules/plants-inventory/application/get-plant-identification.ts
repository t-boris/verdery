/**
 * Read-only lookup for a plant's still-pending photo-identification
 * suggestion, scoped to a garden — mirrors `GetPlant`'s own shape (authorize
 * against the path's own `gardenId` before any repository read, conceal
 * "no such plant" the same way).
 *
 * Added so a client can show what `AddPlantFromPhoto` (ADR-0015) suggested —
 * name and confidence — before deciding whether to call
 * `ConfirmPlantIdentification`; until this pass, neither creating nor
 * confirming a suggestion exposed a way to read it back. Once a suggestion
 * has been confirmed (`plant.acceptedIdentificationId` matches it), this
 * reports "not found" — there is nothing left pending to review.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { plantIdentificationNotFoundError, plantNotFoundError } from './plant-errors.js';
import {
  toPlantIdentificationResource,
  type PlantIdentificationResource,
} from './plant-identification-view.js';
import type { PlantIdentificationRepository } from './plant-identification-repository.js';
import type { PlantRepository } from './plant-repository.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

export class GetPlantIdentification {
  constructor(
    private readonly plants: PlantRepository,
    private readonly plantIdentifications: PlantIdentificationRepository,
    private readonly taxonomyReferences: TaxonomyReferenceRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    plantId: Uuid,
    profileId: Uuid,
  ): Promise<PlantIdentificationResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const plant = await this.plants.findById(plantId);
    if (plant === null || plant.gardenId !== gardenId) {
      throw plantNotFoundError();
    }

    const identification = await this.plantIdentifications.findByPlantId(plantId);
    if (identification === null || identification.id === plant.acceptedIdentificationId) {
      throw plantIdentificationNotFoundError();
    }

    const suggestedTaxonomy =
      identification.suggestedTaxonomyId === null
        ? null
        : await this.taxonomyReferences.findById(identification.suggestedTaxonomyId);

    return toPlantIdentificationResource(identification, suggestedTaxonomy);
  }
}
