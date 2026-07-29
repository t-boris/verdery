/**
 * `apply-plant-revision-guarded-update.ts`'s counterpart for candidates:
 * fetch, check `expectedRevision`, transform, write back guarded by the
 * revision actually observed.
 *
 * Source: architecture/api-design.md, section "7. Optimistic Concurrency".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantCandidate } from '../domain/plant-candidate.js';
import { candidateNotFoundError, candidateStaleRevisionError } from './candidate-errors.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';

export async function applyCandidateRevisionGuardedUpdate(
  candidates: PlantCandidateRepository,
  candidateId: Uuid,
  expectedRevision: number,
  transform: (candidate: PlantCandidate) => PlantCandidate,
): Promise<PlantCandidate> {
  const candidate = await candidates.findById(candidateId);
  if (candidate === null) {
    throw candidateNotFoundError();
  }
  if (candidate.revision !== expectedRevision) {
    throw candidateStaleRevisionError(candidate.revision);
  }

  const updated = transform(candidate);
  const applied = await candidates.update(updated, candidate.revision);
  if (!applied) {
    throw candidateStaleRevisionError(candidate.revision);
  }

  return updated;
}
