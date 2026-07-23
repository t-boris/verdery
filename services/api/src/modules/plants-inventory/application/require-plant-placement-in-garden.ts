/**
 * "If `gardenAreaMapObjectId`/`placementMapObjectId` are given, they must
 * reference a `garden_object` belonging to `gardenId`" — shared by `AddPlant`,
 * `AddPlantFromPhoto`, and `MovePlant`, the three commands that write
 * placement fields.
 *
 * Queries gardens-mapping's own exported `MapObjectRepository` (via its
 * `public.ts`) rather than duplicating its query logic, matching this work
 * package's own instruction. `MapObjectRepository.findById` is already
 * scoped to `gardenId`, so this also rejects a reference naming a real
 * object in a *different* garden — not just any real object anywhere — the
 * same way `requireGateReferencesExistingFence` documents for its own
 * identical scoping.
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { invalidPlantPlacementError } from './plant-errors.js';
import type { PlantPlacement } from '../domain/plant.js';

async function requireActiveGardenObject(
  mapObjects: MapObjectRepository,
  gardenId: Uuid,
  objectId: Uuid,
  pointer: string,
): Promise<void> {
  const object = await mapObjects.findById(gardenId, objectId);
  if (object === null || object.lifecycleState !== 'active') {
    throw invalidPlantPlacementError(pointer);
  }
}

export async function requirePlacementReferencesGardenObjects(
  mapObjects: MapObjectRepository,
  gardenId: Uuid,
  placement: PlantPlacement,
): Promise<void> {
  if (placement.gardenAreaMapObjectId !== null) {
    await requireActiveGardenObject(
      mapObjects,
      gardenId,
      placement.gardenAreaMapObjectId,
      '/gardenAreaMapObjectId',
    );
  }

  if (placement.placementMapObjectId !== null) {
    await requireActiveGardenObject(
      mapObjects,
      gardenId,
      placement.placementMapObjectId,
      '/placementMapObjectId',
    );
  }
}
