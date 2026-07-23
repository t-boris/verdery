import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantPhoto } from '../domain/plant-photo.js';

export interface PlantPhotoRepository {
  /** Scoped to `plantId`, the same convention `MapObjectRepository.findById(gardenId, objectId)` follows: a photo id naming a real row that belongs to a different plant reads back as `null` here, not a separate mismatch case. */
  findById(plantId: Uuid, plantPhotoId: Uuid): Promise<PlantPhoto | null>;

  insert(photo: PlantPhoto): Promise<void>;

  /** Clears `is_primary` on every photo of this plant. `SetPrimaryPlantPhoto` and `AttachPlantPhoto` (when attaching a new primary) call this before setting the new primary, satisfying the migration's partial unique index (`plant_photo_plant_primary_idx`) themselves rather than relying on the database to reject a second `true` row. */
  clearPrimaryForPlant(plantId: Uuid): Promise<void>;

  /** Sets `is_primary = true` on exactly this row. Callers must have already cleared any existing primary for the same plant in the same transaction. */
  setPrimary(plantPhotoId: Uuid): Promise<void>;
}
