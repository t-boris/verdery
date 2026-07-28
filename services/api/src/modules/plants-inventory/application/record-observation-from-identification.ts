/**
 * Turns a pending `plant_identification` row's already-computed condition
 * analysis into a real, dated `Observation` — a second, independent action
 * alongside `ConfirmPlantIdentification` over the exact same row. Both
 * simply read `plant_identification`; calling one does not consume or
 * invalidate the other, and a caller may call either, both, or neither.
 *
 * Deliberately does not re-run `AnalyzePlantCondition`: `AddPlantFromPhoto`
 * already computed `suggestedConditionNote`/`suggestedCareGuidanceNote` once
 * per identification row, so this command passes that stored result straight
 * into `RecordObservation` rather than paying for a second AI call over the
 * same photo. No photo is attached to the created observation — attaching
 * one would re-trigger `RecordObservation`'s own per-photo
 * `AnalyzePlantCondition` pass (see `attach-observation-photos.ts`), the
 * exact duplicate call this command exists to avoid; the observation's own
 * `conditionSummary`/`noteText` carry the analysis text instead.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `recordObservationFromIdentification`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ObservationResource, RecordObservation } from '../../observations-history/public.js';
import {
  plantIdentificationMismatchError,
  plantIdentificationNoObservationSuggestionError,
  plantIdentificationNotFoundError,
} from './plant-errors.js';
import type { PlantIdentificationRepository } from './plant-identification-repository.js';
import type { PlantRepository } from './plant-repository.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';

export class RecordObservationFromIdentification {
  constructor(
    private readonly plants: PlantRepository,
    private readonly plantIdentifications: PlantIdentificationRepository,
    private readonly authorization: GardenAuthorization,
    private readonly recordObservation: RecordObservation,
  ) {}

  async execute(
    plantId: Uuid,
    profileId: Uuid,
    identificationId: Uuid,
    idempotencyKey: string,
  ): Promise<ObservationResource> {
    const plant = await requirePlantAndAuthorize(
      this.plants,
      this.authorization,
      plantId,
      profileId,
    );

    const identification = await this.plantIdentifications.findById(identificationId);
    if (identification === null) {
      throw plantIdentificationNotFoundError();
    }
    if (identification.plantId !== plantId) {
      throw plantIdentificationMismatchError();
    }
    if (identification.suggestedConditionNote === null) {
      throw plantIdentificationNoObservationSuggestionError();
    }

    return this.recordObservation.execute(
      plant.gardenId,
      profileId,
      {
        plantId,
        gardenObjectId: null,
        noteText: identification.suggestedCareGuidanceNote,
        conditionSummary: identification.suggestedConditionNote,
        observedAt: identification.createdAt,
        photoMediaIds: [],
      },
      idempotencyKey,
    );
  }
}
