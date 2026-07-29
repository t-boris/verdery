/**
 * `require-plant-and-authorize.ts`'s counterpart for candidate-scoped
 * commands — same two-step lookup-then-authorize reasoning, retargeted to
 * `PlantCandidateRepository`.
 */

import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantCandidate } from '../domain/plant-candidate.js';
import { candidateNotFoundError } from './candidate-errors.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';

export async function requireCandidateAndAuthorize(
  candidates: PlantCandidateRepository,
  authorization: GardenAuthorization,
  candidateId: Uuid,
  profileId: Uuid,
): Promise<PlantCandidate> {
  const candidate = await candidates.findById(candidateId);
  if (candidate === null) {
    throw candidateNotFoundError();
  }

  await authorization.requireCapability(candidate.gardenId, profileId, 'editGardenContent');

  return candidate;
}
