/**
 * "If `gardenAreaMapObjectId`/`plantId` are given, they must reference a real,
 * active object belonging to `gardenId`" — the existence half of
 * `CreateManualTask`'s target validation; the shape half
 * (`validateTaskTarget`, in `domain/task.ts`) is pure and needs no IO.
 *
 * Queries gardens-mapping's own exported `MapObjectRepository` and
 * plants-inventory's own exported `PlantRepository` (via their `public.ts`
 * files) rather than duplicating either module's query logic — the same
 * judgment `require-plant-placement-in-garden.ts` documents for its own
 * identical shape of check, adapted here to also cover a plant reference
 * (which that file does not need, since a plant is never its own placement
 * target).
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { PlantRepository } from '../../plants-inventory/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskTarget } from '../domain/task.js';
import { invalidTaskTargetReferenceError } from './task-errors.js';

export async function requireTaskTargetReferencesExist(
  mapObjects: MapObjectRepository,
  plants: PlantRepository,
  gardenId: Uuid,
  target: TaskTarget,
): Promise<void> {
  if (target.gardenAreaMapObjectId !== null) {
    const object = await mapObjects.findById(gardenId, target.gardenAreaMapObjectId);
    if (object === null || object.lifecycleState !== 'active') {
      throw invalidTaskTargetReferenceError('/target/gardenAreaMapObjectId');
    }
  }

  if (target.plantId !== null) {
    const plant = await plants.findById(target.plantId);
    if (plant === null || plant.gardenId !== gardenId) {
      throw invalidTaskTargetReferenceError('/target/plantId');
    }
  }
}
