import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantPhoto } from '../domain/plant-photo.js';

export interface PlantPhotoRepository {
  /** Scoped to `plantId`, the same convention `MapObjectRepository.findById(gardenId, objectId)` follows: a photo id naming a real row that belongs to a different plant reads back as `null` here, not a separate mismatch case. */
  findById(plantId: Uuid, plantPhotoId: Uuid): Promise<PlantPhoto | null>;

  /** Every photo attached to this plant, primary first, then oldest first — matches `ListPlantPhotos`'s own ordering contract. */
  findAllForPlant(plantId: Uuid): Promise<PlantPhoto[]>;

  /**
   * The cover photo `SearchPlants` shows per row: one query for a whole page
   * of plants rather than N, picking each plant's primary photo when one is
   * marked, else its oldest — the same "primary first, then oldest first"
   * choice `findAllForPlant`'s own first row already makes, just without
   * loading every other photo to get there. A plant with no photos at all is
   * absent from the returned map, not a `null` entry.
   */
  findCoverMediaIdsForPlants(plantIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, Uuid>>;

  insert(photo: PlantPhoto): Promise<void>;

  /** Clears `is_primary` on every photo of this plant. `SetPrimaryPlantPhoto` and `AttachPlantPhoto` (when attaching a new primary) call this before setting the new primary, satisfying the migration's partial unique index (`plant_photo_plant_primary_idx`) themselves rather than relying on the database to reject a second `true` row. */
  clearPrimaryForPlant(plantId: Uuid): Promise<void>;

  /** Sets `is_primary = true` on exactly this row. Callers must have already cleared any existing primary for the same plant in the same transaction. */
  setPrimary(plantPhotoId: Uuid): Promise<void>;
}
