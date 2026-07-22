/**
 * `apply-revision-guarded-update.ts`'s counterpart for map objects: fetch,
 * check `expectedRevision`, transform, write back guarded by the revision
 * actually observed.
 *
 * A separate function rather than a generic one both garden and map object
 * commands share: `Garden` and `MapObject` are different aggregates with
 * different repositories, and the two guarded-update call sites are each
 * small enough that sharing would cost more in generic-type indirection than
 * it would save in duplicated lines.
 *
 * Source: architecture/api-design.md, section "7. Optimistic Concurrency".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MapObject } from '../domain/map-object.js';
import { mapObjectNotFoundError, mapObjectStaleRevisionError } from './map-object-errors.js';
import type { MapObjectRepository } from './map-object-repository.js';

export async function applyMapObjectRevisionGuardedUpdate(
  mapObjects: MapObjectRepository,
  gardenId: Uuid,
  objectId: Uuid,
  expectedRevision: number,
  transform: (object: MapObject) => MapObject,
): Promise<MapObject> {
  const object = await mapObjects.findByIdWithDetails(gardenId, objectId);
  if (object === null) {
    throw mapObjectNotFoundError();
  }
  if (object.currentRevision !== expectedRevision) {
    throw mapObjectStaleRevisionError(object.currentRevision);
  }

  const updated = transform(object);
  const applied = await mapObjects.update(updated, object.currentRevision);
  if (!applied) {
    throw mapObjectStaleRevisionError(object.currentRevision);
  }

  return updated;
}
