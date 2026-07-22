import type { MoveObjectPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { translateGeometry } from '../domain/geometry-edit.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.moveObject';

/** What a drag gesture commits as: a fixed translation applied to every position in the object's geometry. */
export class MoveMapObject {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: MoveObjectPayload,
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
      const moved = await applyMapObjectRevisionGuardedUpdate(
        context.mapObjects,
        gardenId,
        payload.objectId,
        payload.expectedRevision,
        (object) => {
          const geometry = translateGeometry(
            object.geometry,
            payload.translationMetres.dx,
            payload.translationMetres.dy,
          );
          requireValidGeometryForCategory(object.category, geometry);
          return {
            ...object,
            geometry,
            currentRevision: object.currentRevision + 1,
            updatedAt: now,
          };
        },
      );

      await context.revisionJournal.record({
        gardenObjectId: moved.id,
        revision: moved.currentRevision,
        commandType: 'moveObject',
        geometry: moved.geometry,
        label: moved.label,
        lifecycleState: moved.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: moved.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: moved.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.moved',
        aggregateType: 'gardenObject',
        aggregateId: moved.id,
        payload: { gardenId, translationMetres: payload.translationMetres },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.moved',
        subjectType: 'gardenObject',
        subjectId: moved.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(moved)] };
    });
  }
}
