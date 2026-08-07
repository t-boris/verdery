import { SharedErrorCode } from '@verdery/api-contracts';
import type { MoveObjectsPayload } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { translateGeometry } from '../domain/geometry-edit.js';
import type { MapObject } from '../domain/map-object.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import {
  mapObjectNotFoundError,
  mapObjectStaleRevisionError,
  requireMapObjectEditable,
} from './map-object-errors.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireBackgroundGeometryEditable } from './validate-imported-background-state.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.moveObjects';

/** Applies one explicit drag to an entire selection inside one transaction. */
export class MoveMapObjects {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: MoveObjectsPayload,
    idempotencyKey: string,
  ): Promise<MapCommandResultResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');
    if (payload.targets.length < 2 || payload.targets.length > 100) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        'moveObjects requires between 2 and 100 unique targets.',
        { details: [{ code: 'map.move_objects.target_count', pointer: '/payload/targets' }] },
      );
    }
    if (new Set(payload.targets.map((target) => target.objectId)).size !== payload.targets.length) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        'moveObjects targets must be unique.',
        { details: [{ code: 'map.move_objects.duplicate_target', pointer: '/payload/targets' }] },
      );
    }

    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, payload }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      const moved: MapObject[] = [];

      for (const target of payload.targets) {
        const object = await context.mapObjects.findByIdWithDetails(gardenId, target.objectId);
        if (object === null) {
          throw mapObjectNotFoundError();
        }
        if (object.currentRevision !== target.expectedRevision) {
          throw mapObjectStaleRevisionError(object.currentRevision);
        }
        requireMapObjectEditable(object);
        requireBackgroundGeometryEditable(object);
        const geometry = translateGeometry(
          object.geometry,
          payload.translationMetres.dx,
          payload.translationMetres.dy,
        );
        requireValidGeometryForCategory(object.category, geometry);
        moved.push({
          ...object,
          geometry,
          currentRevision: object.currentRevision + 1,
          updatedAt: now,
        });
      }

      for (const object of moved) {
        const applied = await context.mapObjects.update(object, object.currentRevision - 1);
        if (!applied) {
          throw mapObjectStaleRevisionError(object.currentRevision - 1);
        }
        await context.revisionJournal.record({
          gardenObjectId: object.id,
          revision: object.currentRevision,
          commandType: 'moveObjects',
          geometry: object.geometry,
          label: object.label,
          lifecycleState: object.lifecycleState,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId,
          recordId: object.id,
          recordType: 'gardenObject',
          operation: 'upsert',
          recordRevision: object.currentRevision,
        });
      }

      await context.outbox.append({
        eventType: 'mapObjects.moved',
        aggregateType: 'garden',
        aggregateId: gardenId,
        payload: {
          gardenId,
          objectIds: moved.map((object) => object.id),
          translationMetres: payload.translationMetres,
        },
      });
      await context.auditLogger.record({
        eventType: 'mapObjects.moved',
        subjectType: 'garden',
        subjectId: gardenId,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: moved.map(toGardenObjectResource) };
    });
  }
}
