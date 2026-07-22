/**
 * "A gate's `fenceObjectId` must reference an existing fence object in the
 * same garden" — one of the two reference checks this work package's
 * validation pass names explicitly (the other is `AssignPlantToTarget`'s own
 * target check). Shared by `CreateMapObject` and `ChangeMapObjectProperties`,
 * the two commands that can attach `GateDetails`.
 *
 * `MapObjectRepository.findById` is scoped to `gardenId` already, so this
 * also rejects a `fenceObjectId` that names a real object in a *different*
 * garden — not just any real fence anywhere.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { GardenObjectDetails } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MapObjectRepository } from './map-object-repository.js';

export async function requireGateReferencesExistingFence(
  mapObjects: MapObjectRepository,
  gardenId: Uuid,
  details: GardenObjectDetails | undefined,
): Promise<void> {
  if (details === undefined || details.category !== 'gate') {
    return;
  }

  const fence = await mapObjects.findById(gardenId, details.details.fenceObjectId);
  if (fence === null || fence.category !== 'fence') {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "A gate's fenceObjectId must reference an existing fence object in this garden.",
      {
        details: [{ code: 'map.gate.fence_not_found', pointer: '/categoryDetails/fenceObjectId' }],
      },
    );
  }
}
