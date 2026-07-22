import type { DuplicateObjectPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { translateGeometry } from '../domain/geometry-edit.js';
import type { MapObject } from '../domain/map-object.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { mapObjectNotFoundError } from './map-object-errors.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.duplicateObject';

/**
 * Copies `sourceObjectId` as a new object at `newObjectId`, offset by
 * `offsetMetres`. No `expectedRevision` on this command — the source is only
 * read, never written, so there is nothing on the source side to guard.
 */
export class DuplicateMapObject {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: DuplicateObjectPayload,
    idempotencyKey: string,
  ): Promise<MapCommandResultResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, payload }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      const source = await context.mapObjects.findByIdWithDetails(gardenId, payload.sourceObjectId);
      if (source === null) {
        throw mapObjectNotFoundError();
      }

      const geometry = translateGeometry(
        source.geometry,
        payload.offsetMetres.dx,
        payload.offsetMetres.dy,
      );
      requireValidGeometryForCategory(source.category, geometry);

      const duplicate: MapObject = {
        ...source,
        id: payload.newObjectId,
        geometry,
        lifecycleState: 'active',
        currentRevision: 1,
        createdByProfileId: profileId,
        createdAt: now,
        updatedAt: now,
      };
      await context.mapObjects.insert(duplicate);

      await context.revisionJournal.record({
        gardenObjectId: duplicate.id,
        revision: duplicate.currentRevision,
        commandType: 'duplicateObject',
        geometry: duplicate.geometry,
        label: duplicate.label,
        lifecycleState: duplicate.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: duplicate.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: duplicate.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.duplicated',
        aggregateType: 'gardenObject',
        aggregateId: duplicate.id,
        payload: { gardenId, sourceObjectId: source.id },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.duplicated',
        subjectType: 'gardenObject',
        subjectId: duplicate.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(duplicate)] };
    });
  }
}
