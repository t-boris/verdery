import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Plant } from '../domain/plant.js';

export interface PlantRepository {
  findById(plantId: Uuid): Promise<Plant | null>;
  insert(plant: Plant): Promise<void>;

  /**
   * Writes the plant's new state guarded by `expectedRevision`. Returns
   * `false` when the stored revision no longer matches, without throwing —
   * the same `boolean`-return contract `GardenRepository.update` and
   * `MapObjectRepository.update` already follow, letting the caller (`
   * apply-plant-revision-guarded-update.ts`) decide how to report it.
   */
  update(plant: Plant, expectedRevision: number): Promise<boolean>;
}
