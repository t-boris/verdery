import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantIdentification } from '../domain/plant-identification.js';

export interface PlantIdentificationRepository {
  /**
   * Unscoped by design, unlike `PlantPhotoRepository.findById`:
   * `ConfirmPlantIdentification`'s own command spec calls for a distinct
   * typed error when the row exists but names a different plant ("reject
   * otherwise with a typed domain error, not a generic failure"), not the
   * same concealed-as-`null` treatment a scoped query would give both cases.
   * See `application/confirm-plant-identification.ts`.
   */
  findById(identificationId: Uuid): Promise<PlantIdentification | null>;

  /**
   * The most recent identification row for a plant, or `null` when none
   * exists. Ordered `createdAt` descending in anticipation of a future
   * re-identify command inserting more than one row per plant — today
   * `AddPlantFromPhoto` is the only writer, so at most one row exists per
   * plant in practice. Backs `GetPlantIdentification`'s read of a still-
   * pending suggestion.
   */
  findByPlantId(plantId: Uuid): Promise<PlantIdentification | null>;

  insert(identification: PlantIdentification): Promise<void>;
}
