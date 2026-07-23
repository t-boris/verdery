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

  insert(identification: PlantIdentification): Promise<void>;
}
