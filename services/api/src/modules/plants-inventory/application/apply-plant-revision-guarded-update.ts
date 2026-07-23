/**
 * `apply-revision-guarded-update.ts`'s counterpart for plants: fetch, check
 * `expectedRevision`, transform, write back guarded by the revision actually
 * observed — exactly gardens-mapping's own pattern
 * (`GardenRepository`/`applyRevisionGuardedUpdate`), retargeted to
 * `PlantRepository`.
 *
 * Source: architecture/api-design.md, section "7. Optimistic Concurrency".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Plant } from '../domain/plant.js';
import { plantNotFoundError, plantStaleRevisionError } from './plant-errors.js';
import type { PlantRepository } from './plant-repository.js';

export async function applyPlantRevisionGuardedUpdate(
  plants: PlantRepository,
  plantId: Uuid,
  expectedRevision: number,
  transform: (plant: Plant) => Plant,
): Promise<Plant> {
  const plant = await plants.findById(plantId);
  if (plant === null) {
    throw plantNotFoundError();
  }
  if (plant.revision !== expectedRevision) {
    throw plantStaleRevisionError(plant.revision);
  }

  const updated = transform(plant);
  const applied = await plants.update(updated, plant.revision);
  if (!applied) {
    throw plantStaleRevisionError(plant.revision);
  }

  return updated;
}
