import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { CandidateDetailsChanges } from '../domain/plant-candidate.js';
import { updateCandidateDetails } from '../domain/plant-candidate.js';
import { applyCandidateRevisionGuardedUpdate } from './apply-candidate-revision-guarded-update.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requireCandidateAndAuthorize } from './require-candidate-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.updateCandidateDetails';

export class UpdateCandidateDetails {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    candidateId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    changes: CandidateDetailsChanges,
    idempotencyKey: string,
  ): Promise<CandidateResource> {
    await requireCandidateAndAuthorize(this.candidates, this.authorization, candidateId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ candidateId, expectedRevision, changes }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const now = this.clock.now();
        const updated = await applyCandidateRevisionGuardedUpdate(
          context.candidates,
          candidateId,
          expectedRevision,
          (candidate) => updateCandidateDetails(candidate, changes, now),
        );

        // Sync push/pull for candidates remains deferred — see
        // `add-candidate.ts`'s identical note.

        return toCandidateResource(updated);
      },
    );
  }
}
