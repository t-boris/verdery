/**
 * Permanently removes a candidate and every row that depends on it.
 *
 * This is the counterpart to `set-candidate-status.ts`, not a replacement for
 * it. Archiving or rejecting remains how a candidate whose evaluation is worth
 * keeping is disposed of; this exists for the candidate that should never have
 * existed, and it keeps nothing.
 *
 * A `converted` candidate is refused. Its `candidate_conversion` row is the
 * resulting plant's provenance, and FR-19 requires conversion to preserve the
 * evaluation and decision history — deleting the candidate would leave a plant
 * whose origin cannot be explained. The plant's own lifecycle is where an
 * unwanted conversion gets undone.
 *
 * ORDER MATTERS, and it is not alphabetical. Dependents go first so the final
 * delete cannot fail a foreign key, and `clearAlternativeReferences` runs
 * before it too because a sibling candidate pointing at this one is a
 * dependency exactly like a photo link is — the difference is only that the
 * sibling survives.
 *
 * The media records behind the photo links are deliberately left alone. A
 * photo may be referenced elsewhere, and media rows have their own retention
 * lifecycle that the media module owns; deleting a link is not deleting a
 * photo.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `deleteCandidate`;
 * implementation-plan.md work package P11-API-01.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { candidateAlreadyConvertedError, candidateStaleRevisionError } from './candidate-errors.js';
import { requireCandidateAndAuthorize } from './require-candidate-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.deleteCandidate';
const RESPONSE_STATUS_CODE = 204;

export class DeleteCandidate {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    candidateId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<void> {
    const candidate = await requireCandidateAndAuthorize(
      this.candidates,
      this.authorization,
      candidateId,
      profileId,
    );

    if (candidate.status === 'converted') {
      throw candidateAlreadyConvertedError();
    }

    if (candidate.revision !== expectedRevision) {
      throw candidateStaleRevisionError(candidate.revision);
    }

    await runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      {
        actorProfileId: profileId,
        operation: OPERATION,
        idempotencyKey,
        requestFingerprint: JSON.stringify({ candidateId, expectedRevision }),
      },
      RESPONSE_STATUS_CODE,
      async (context) => {
        await context.candidateSuitability.deleteAllForCandidate(candidateId);
        await context.candidatePhotos.deleteAllForCandidate(candidateId);
        await context.candidates.clearAlternativeReferences(candidateId);

        // Re-checked inside the transaction rather than trusting the read
        // above: between that read and this write another writer may have
        // bumped the revision, and the guard is the only thing standing
        // between a concurrent edit and a deletion that ignores it.
        const deleted = await context.candidates.deleteById(candidateId, expectedRevision);
        if (!deleted) {
          throw candidateStaleRevisionError(candidate.revision);
        }

        // Sync push/pull for candidates remains deferred — see
        // `add-candidate.ts`'s identical note.

        return null;
      },
    );
  }
}
