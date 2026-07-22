import { SharedErrorCode } from '@verdery/api-contracts';
import type { JoinLineworkPayload } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { joinLineStrings } from '../domain/geometry-edit.js';
import type { MapObject } from '../domain/map-object.js';
import { transitionMapObjectLifecycle } from '../domain/map-object-lifecycle.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { mapObjectNotFoundError, mapObjectStaleRevisionError } from './map-object-errors.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.joinLinework';

/** The mirror of `SplitMapObjectLinework`: two existing LineString objects are soft-deleted and replaced by one new joined object. */
export class JoinMapObjectLinework {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: JoinLineworkPayload,
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

      const first = await context.mapObjects.findByIdWithDetails(gardenId, payload.firstObjectId);
      if (first === null) {
        throw mapObjectNotFoundError();
      }
      if (first.currentRevision !== payload.firstExpectedRevision) {
        throw mapObjectStaleRevisionError(first.currentRevision);
      }

      const second = await context.mapObjects.findByIdWithDetails(gardenId, payload.secondObjectId);
      if (second === null) {
        throw mapObjectNotFoundError();
      }
      if (second.currentRevision !== payload.secondExpectedRevision) {
        throw mapObjectStaleRevisionError(second.currentRevision);
      }

      if (first.category !== second.category) {
        throw new ValidationError(
          SharedErrorCode.RequestInvalid,
          'joinLinework requires both objects to share the same category.',
          { details: [{ code: 'map.join_linework.category_mismatch', pointer: '/payload' }] },
        );
      }

      const joinedGeometry = joinLineStrings(first.geometry, second.geometry);
      requireValidGeometryForCategory(first.category, joinedGeometry);

      const deletedFirst = transitionMapObjectLifecycle(first, 'deleted', now);
      const appliedFirst = await context.mapObjects.update(deletedFirst, first.currentRevision);
      if (!appliedFirst) {
        throw mapObjectStaleRevisionError(first.currentRevision);
      }

      const deletedSecond = transitionMapObjectLifecycle(second, 'deleted', now);
      const appliedSecond = await context.mapObjects.update(deletedSecond, second.currentRevision);
      if (!appliedSecond) {
        throw mapObjectStaleRevisionError(second.currentRevision);
      }

      const joined: MapObject = {
        ...first,
        id: payload.resultObjectId,
        geometry: joinedGeometry,
        currentRevision: 1,
        lifecycleState: 'active',
        createdByProfileId: profileId,
        createdAt: now,
        updatedAt: now,
      };
      await context.mapObjects.insert(joined);

      for (const result of [
        { object: deletedFirst, operation: 'delete' as const },
        { object: deletedSecond, operation: 'delete' as const },
        { object: joined, operation: 'upsert' as const },
      ]) {
        await context.revisionJournal.record({
          gardenObjectId: result.object.id,
          revision: result.object.currentRevision,
          commandType: 'joinLinework',
          geometry: result.operation === 'delete' ? null : result.object.geometry,
          label: result.object.label,
          lifecycleState: result.object.lifecycleState,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId,
          recordId: result.object.id,
          recordType: 'gardenObject',
          operation: result.operation,
          recordRevision: result.object.currentRevision,
        });
      }

      await context.outbox.append({
        eventType: 'mapObject.joined',
        aggregateType: 'gardenObject',
        aggregateId: joined.id,
        payload: { gardenId, sourceObjectIds: [first.id, second.id] },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.joined',
        subjectType: 'gardenObject',
        subjectId: joined.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return {
        affectedObjects: [deletedFirst, deletedSecond, joined].map(toGardenObjectResource),
      };
    });
  }
}
