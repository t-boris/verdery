/**
 * Read-only lookup for a single candidate, scoped to a garden — mirrors
 * `get-plant.ts`'s own shape exactly: authorize against the path's own
 * `gardenId` before any repository read, then conceal both "no such
 * candidate" and "belongs to a different garden" as the identical
 * `candidateNotFoundError`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import { candidateNotFoundError } from './candidate-errors.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';

export class GetCandidate {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, candidateId: Uuid, profileId: Uuid): Promise<CandidateResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const candidate = await this.candidates.findById(candidateId);
    if (candidate === null || candidate.gardenId !== gardenId) {
      throw candidateNotFoundError();
    }

    return toCandidateResource(candidate);
  }
}
