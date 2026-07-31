/**
 * Sets a health suggestion's (`image_analysis_result`) disposition — the
 * design doc's own four-state vocabulary (plant-intelligence-and-visual-
 * journal.md, section 9): `confirmed_externally`, `accepted_as_observation`,
 * `rejected`, `unresolved`. The garden the underlying observation belongs
 * to is resolved through `observation_photo` -> `observation` (see
 * `ImageAnalysisResultRepository.getWithGardenContext`'s own doc comment),
 * since `image_analysis_result` carries no `garden_id` of its own.
 *
 * Looks up the existing row and authorizes BEFORE the idempotency-guarded
 * transaction, the same shape and ordering `CorrectObservation` already
 * uses for its own original-observation lookup (`observations`, a pooled,
 * non-transactional dependency, distinct from `context.imageAnalysisResults`
 * inside the transaction) — an authorization failure must not depend on
 * idempotency-cache state.
 *
 * No `expectedRevision`/`If-Match`: `image_analysis_result` carries no
 * revision column, matching `Observation`'s own posture. A disposition may
 * be reconsidered freely (see `applyHealthSuggestionDisposition`'s own doc
 * comment) — a later write simply overwrites an earlier one, the same
 * last-writer-wins posture `RecordGardenContextFact` already takes for a
 * different aggregate with the identical "no concurrent-edit contest worth
 * guarding" reasoning.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { applyHealthSuggestionDisposition } from '../domain/image-analysis-result.js';
import type { ImageAnalysisResultRepository } from './image-analysis-result-repository.js';
import { imageAnalysisResultNotFoundError } from './observation-errors.js';
import {
  toImageAnalysisResultResource,
  type ImageAnalysisResultResource,
} from './observation-view.js';
import type { ObservationsHistoryUnitOfWork } from './observations-history-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'observations.setHealthSuggestionDisposition';
const RESPONSE_STATUS_CODE = 200;

export class SetHealthSuggestionDisposition {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: ObservationsHistoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    /** Pooled, non-transactional lookup — the same pattern `CorrectObservation` uses its pooled `ObservationRepository` for. */
    private readonly imageAnalysisResults: ImageAnalysisResultRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    analysisResultId: Uuid,
    profileId: Uuid,
    rawDisposition: string,
    idempotencyKey: string,
  ): Promise<ImageAnalysisResultResource> {
    const existing = await this.imageAnalysisResults.getWithGardenContext(analysisResultId);
    if (existing === null) {
      throw imageAnalysisResultNotFoundError();
    }

    await this.authorization.requireCapability(existing.gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ analysisResultId, rawDisposition }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      RESPONSE_STATUS_CODE,
      async (context) => {
        const now = this.clock.now();
        const updated = applyHealthSuggestionDisposition(
          existing.result,
          rawDisposition,
          profileId,
          now,
        );
        await context.imageAnalysisResults.update(updated);

        return toImageAnalysisResultResource(updated);
      },
    );
  }
}
