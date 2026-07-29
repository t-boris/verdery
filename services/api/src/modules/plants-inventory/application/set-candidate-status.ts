/**
 * Sets `plant_candidate.status` to `active`/`archived`/`rejected` — never
 * `converted`, which only `ConvertCandidate` may reach. Mirrors
 * `set-plant-status.ts`'s own reasoning: this is how "delete a candidate" is
 * modeled — a transition to `'archived'`/`'rejected'`, never a hard delete.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { CandidateStatus } from '../domain/plant-candidate.js';
import { setCandidateStatus } from '../domain/plant-candidate.js';
import { applyCandidateRevisionGuardedUpdate } from './apply-candidate-revision-guarded-update.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requireCandidateAndAuthorize } from './require-candidate-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.setCandidateStatus';

export class SetCandidateStatus {
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
    newStatus: Exclude<CandidateStatus, 'converted'>,
    idempotencyKey: string,
  ): Promise<CandidateResource> {
    await requireCandidateAndAuthorize(this.candidates, this.authorization, candidateId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ candidateId, expectedRevision, newStatus }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const now = this.clock.now();
        const transitioned = await applyCandidateRevisionGuardedUpdate(
          context.candidates,
          candidateId,
          expectedRevision,
          (candidate) => setCandidateStatus(candidate, newStatus, now),
        );

        // Sync push/pull for candidates remains deferred — see
        // `add-candidate.ts`'s identical note.

        return toCandidateResource(transitioned);
      },
    );
  }
}
