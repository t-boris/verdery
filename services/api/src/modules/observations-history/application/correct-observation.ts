/**
 * Corrects a prior observation by inserting a new row that points backward
 * to it — never by mutating the original. `originalObservationId` must
 * already exist, or this rejects with `observationNotFoundError`.
 *
 * `gardenId` for the authorization check is discovered from the original
 * row itself: correction commands take no `gardenId` parameter of their
 * own, since the caller only has the observation being corrected, not the
 * garden it lives in. Fetching `original` once, outside the transaction, and
 * reusing its `gardenId`/`plantId`/`gardenObjectId` inside it without
 * re-reading is safe specifically *because* `observation` rows are immutable
 * after insert (see `domain/observation.ts`) — there is no revision for a
 * concurrent write to have raced ahead of, unlike the read-modify-write
 * commands in `gardens-mapping`'s own `apply-revision-guarded-update.ts`.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import {
  createCorrectionObservation,
  type ObservationCorrectionKind,
} from '../domain/observation.js';
import { attachObservationPhotos } from './attach-observation-photos.js';
import { observationNotFoundError } from './observation-errors.js';
import type { ObservationRepository } from './observation-repository.js';
import { toObservationResource, type ObservationResource } from './observation-view.js';
import type { ObservationsHistoryUnitOfWork } from './observations-history-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

export interface CorrectObservationInput {
  /** Client-generated id for the new correction row, when supplied. See `AddPlantInput.plantId`'s own doc comment (plants-inventory/application/add-plant.ts) for why this is optional and additive — matches `SyncCorrectObservationCommand.observationId` (the new correction row's id, distinct from `correctedObservationId`, the id passed as this command's own `originalObservationId`). */
  readonly observationId?: Uuid;
  readonly correctionKind: ObservationCorrectionKind;
  readonly noteText: string | null;
  readonly conditionSummary: string | null;
  readonly photoMediaIds: readonly Uuid[];
}

const OPERATION = 'observations.correct';
const RESPONSE_STATUS_CODE = 201;

export class CorrectObservation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: ObservationsHistoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    /** Pooled, non-transactional lookup of the original — the same pattern `GetGarden` uses its pooled `GardenRepository` for. */
    private readonly observations: ObservationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    originalObservationId: Uuid,
    profileId: Uuid,
    input: CorrectObservationInput,
    idempotencyKey: string,
  ): Promise<ObservationResource> {
    const original = await this.observations.get(originalObservationId);
    if (original === null) {
      throw observationNotFoundError();
    }

    await this.authorization.requireCapability(original.gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ originalObservationId, ...input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      RESPONSE_STATUS_CODE,
      async (context) => {
        const now = this.clock.now();

        const correction = createCorrectionObservation({
          id: input.observationId ?? generateUuidV7(),
          original,
          correctionKind: input.correctionKind,
          actorProfileId: profileId,
          rawNoteText: input.noteText,
          rawConditionSummary: input.conditionSummary,
          observedAt: now,
          photoCount: input.photoMediaIds.length,
          now,
        });
        await context.observations.insert(correction);
        // 'upsert' at `recordRevision: 1`, exactly like `RecordObservation`:
        // a correction is a new row with its own new `record_id` (see
        // `domain/observation.ts`'s `createCorrectionObservation`), never a
        // mutation of the original — so it is its own separate sync-change
        // insert, not an update to the original observation's row, and it
        // is that new row's own first-and-only revision.
        await context.syncChanges.record({
          gardenId: correction.gardenId,
          recordId: correction.id,
          recordType: 'observation',
          operation: 'upsert',
          recordRevision: 1,
        });

        const photos = await attachObservationPhotos(
          context,
          correction.id,
          input.photoMediaIds,
          now,
        );

        return toObservationResource({ observation: correction, isCorrected: false, photos });
      },
    );
  }
}
