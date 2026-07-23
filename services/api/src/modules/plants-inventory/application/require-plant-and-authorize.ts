/**
 * Fetches the plant a plant-scoped command targets, then authorizes the
 * caller against the garden that plant belongs to.
 *
 * Every command in this module that receives only a `plantId` (not a
 * `gardenId`) needs this same two-step lookup before it can run its own
 * idempotency/transaction flow: `GardenAuthorization.requireCapability`
 * needs a `gardenId`, and only the plant row itself can supply one for these
 * commands — unlike gardens-mapping's own commands, which always receive
 * `gardenId` directly (their routes are garden-scoped URLs) and so authorize
 * before any repository read at all (see, for example,
 * `MoveMapObject.execute`). Reusing `gardens-mapping`'s own exported
 * `GardenAuthorization` (via its `public.ts`) rather than building a second
 * authorization module, per this module's own scope.
 *
 * Runs against the pooled connection, not a transaction — the same
 * before-the-transaction placement gardens-mapping's own authorization calls
 * use, so a caller lacking the capability never reaches the idempotency
 * check or opens a transaction at all.
 */

import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Plant } from '../domain/plant.js';
import { plantNotFoundError } from './plant-errors.js';
import type { PlantRepository } from './plant-repository.js';

export async function requirePlantAndAuthorize(
  plants: PlantRepository,
  authorization: GardenAuthorization,
  plantId: Uuid,
  profileId: Uuid,
): Promise<Plant> {
  const plant = await plants.findById(plantId);
  if (plant === null) {
    throw plantNotFoundError();
  }

  await authorization.requireCapability(plant.gardenId, profileId, 'editGardenContent');

  return plant;
}
