/**
 * `require-plant-placement-in-garden.ts`'s counterpart for a candidate's
 * PROPOSED placement — same rule, same reasoning, retargeted field names.
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidatePlacement } from '../domain/plant-candidate.js';
import { invalidCandidatePlacementError } from './candidate-errors.js';

async function requireActiveGardenObject(
  mapObjects: MapObjectRepository,
  gardenId: Uuid,
  objectId: Uuid,
  pointer: string,
): Promise<void> {
  const object = await mapObjects.findById(gardenId, objectId);
  if (object === null || object.lifecycleState !== 'active') {
    throw invalidCandidatePlacementError(pointer);
  }
}

export async function requireCandidatePlacementReferencesGardenObjects(
  mapObjects: MapObjectRepository,
  gardenId: Uuid,
  placement: CandidatePlacement,
): Promise<void> {
  if (placement.proposedGardenAreaMapObjectId !== null) {
    await requireActiveGardenObject(
      mapObjects,
      gardenId,
      placement.proposedGardenAreaMapObjectId,
      '/proposedGardenAreaMapObjectId',
    );
  }

  if (placement.proposedPlacementMapObjectId !== null) {
    await requireActiveGardenObject(
      mapObjects,
      gardenId,
      placement.proposedPlacementMapObjectId,
      '/proposedPlacementMapObjectId',
    );
  }
}
