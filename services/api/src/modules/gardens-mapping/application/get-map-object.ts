/**
 * Read-only, authorized lookup for a single garden object.
 *
 * Added for the synchronization module's `POST /v1/sync/push`: a
 * `SyncConflictOperationResult` for a `gardenObject` operation needs the
 * current authorized server representation (section "14.2 Same Mutable
 * Object"), and nothing before this exposed a single-object,
 * capability-checked read — `GetGardenMap` returns the whole map document,
 * not one object. Mirrors `GetGarden`'s and `GetPlant`'s own shape exactly:
 * authorize first, against the path's own `gardenId`, then fetch by id and
 * conceal both "no such object" and "this object belongs to a different
 * garden" as the identical `mapObjectNotFoundError`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { mapObjectNotFoundError } from './map-object-errors.js';
import type { MapObjectRepository } from './map-object-repository.js';
import { toGardenObjectResource, type GardenObjectResource } from './map-object-view.js';

export class GetMapObject {
  constructor(
    private readonly mapObjects: MapObjectRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, objectId: Uuid, profileId: Uuid): Promise<GardenObjectResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const object = await this.mapObjects.findByIdWithDetails(gardenId, objectId);
    if (object === null) {
      throw mapObjectNotFoundError();
    }

    return toGardenObjectResource(object);
  }
}
