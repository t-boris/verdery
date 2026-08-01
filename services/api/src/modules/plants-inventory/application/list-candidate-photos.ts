/**
 * Read-only listing of a candidate's attached photos, scoped to a garden —
 * mirrors `ListPlantPhotos`'s own shape exactly, retargeted to candidates.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listCandidatePhotos`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { candidateNotFoundError } from './candidate-errors.js';
import {
  toPlantCandidatePhotoResource,
  type PlantCandidatePhotoResource,
} from './plant-candidate-photo-view.js';
import type { PlantCandidatePhotoRepository } from './plant-candidate-photo-repository.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';

export class ListCandidatePhotos {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly candidatePhotos: PlantCandidatePhotoRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    candidateId: Uuid,
    profileId: Uuid,
  ): Promise<readonly PlantCandidatePhotoResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const candidate = await this.candidates.findById(candidateId);
    if (candidate === null || candidate.gardenId !== gardenId) {
      throw candidateNotFoundError();
    }

    const photos = await this.candidatePhotos.findAllForCandidate(candidateId);
    return photos.map(toPlantCandidatePhotoResource);
  }
}
