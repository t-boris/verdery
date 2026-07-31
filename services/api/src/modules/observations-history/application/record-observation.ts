/**
 * Records a new observation: a note, a condition summary, and/or photos
 * about a garden, a plant within it, or an area (`gardenObjectId`), plus one
 * real `AnalyzeObservationPhoto` pass (ADR-0015) per attached photo — all in
 * one transaction.
 *
 * Idempotency-guarded like every user-initiated command in this codebase,
 * even though `observation` itself carries no `expectedRevision` to check —
 * see `run-idempotent-command.ts`'s doc comment for why idempotency and "no
 * revision guard" are independent concerns here, not a contradiction.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { AnalyzePlantCondition } from '../../integrations/public.js';
import { createObservation } from '../domain/observation.js';
import { createObservationMeasurement } from '../domain/observation-measurement.js';
import {
  attachObservationPhotos,
  type ObservationPhotoAttachmentInput,
} from './attach-observation-photos.js';
import { plantNotInGardenError } from './observation-errors.js';
import { toObservationResource, type ObservationResource } from './observation-view.js';
import type { ObservationsHistoryUnitOfWork } from './observations-history-unit-of-work.js';
import { resolveObservedContextSnapshot } from './resolve-observed-context-snapshot.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

/** One requested measurement, mirroring `createObservationMeasurement`'s raw (unvalidated) inputs. */
export interface ObservationMeasurementInput {
  readonly kind: string;
  readonly value: number;
  readonly unit: string;
}

export interface RecordObservationInput {
  /** Client-generated id for the new observation, when supplied. See `AddPlantInput.plantId`'s own doc comment (plants-inventory/application/add-plant.ts) for why this is optional and additive — matches `SyncRecordObservationCommand.observationId`. */
  readonly observationId?: Uuid;
  readonly plantId: Uuid | null;
  readonly gardenObjectId: Uuid | null;
  readonly noteText: string | null;
  readonly conditionSummary: string | null;
  /** `null` means "use the command's own timestamp" — see `execute` below. */
  readonly observedAt: Date | null;
  readonly photos: readonly ObservationPhotoAttachmentInput[];
  readonly measurements: readonly ObservationMeasurementInput[];
  /** What the observer reported seeing, distinct from the plant's own current `lifecycleStage` — see `domain/observation.ts`'s header comment. */
  readonly observedPhenologicalStage: string | null;
}

const OPERATION = 'observations.record';
const RESPONSE_STATUS_CODE = 201;

export class RecordObservation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: ObservationsHistoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
    private readonly analyzePlantCondition: AnalyzePlantCondition,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: RecordObservationInput,
    idempotencyKey: string,
  ): Promise<ObservationResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, ...input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      RESPONSE_STATUS_CODE,
      async (context) => {
        const now = this.clock.now();

        if (input.plantId !== null) {
          const ownerGardenId = await context.plants.findGardenId(input.plantId);
          if (ownerGardenId === null || ownerGardenId !== gardenId) {
            throw plantNotInGardenError();
          }
        }

        const contextFacts = await context.gardenContextFacts.listForGarden(gardenId);

        const observation = createObservation({
          id: input.observationId ?? generateUuidV7(),
          gardenId,
          plantId: input.plantId,
          gardenObjectId: input.gardenObjectId,
          actorProfileId: profileId,
          rawNoteText: input.noteText,
          rawConditionSummary: input.conditionSummary,
          rawObservedPhenologicalStage: input.observedPhenologicalStage,
          contextSnapshot: resolveObservedContextSnapshot(contextFacts),
          observedAt: input.observedAt ?? now,
          photoCount: input.photos.length,
          now,
        });
        await context.observations.insert(observation);
        // `recordRevision: 1` always: `observation` carries no revision
        // column — every row is a first-and-only insert (see
        // `domain/observation.ts`'s own header comment) — so `1` is this
        // aggregate's genuinely constant value, not a placeholder.
        await context.syncChanges.record({
          gardenId: observation.gardenId,
          recordId: observation.id,
          recordType: 'observation',
          operation: 'upsert',
          recordRevision: 1,
        });

        const photos = await attachObservationPhotos(
          context,
          this.analyzePlantCondition,
          observation.gardenId,
          observation.id,
          input.photos,
          now,
        );

        const measurements = [];
        for (const measurementInput of input.measurements) {
          const measurement = createObservationMeasurement(
            generateUuidV7(),
            observation.id,
            measurementInput.kind,
            measurementInput.value,
            measurementInput.unit,
            now,
          );
          await context.observationMeasurements.insert(measurement);
          measurements.push(measurement);
        }

        return toObservationResource({ observation, isCorrected: false, photos, measurements });
      },
    );
  }
}
