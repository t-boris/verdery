import type { SplitLineworkPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { splitLineString } from '../domain/geometry-edit.js';
import type { MapObject } from '../domain/map-object.js';
import { transitionMapObjectLifecycle } from '../domain/map-object-lifecycle.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { mapObjectNotFoundError, mapObjectStaleRevisionError } from './map-object-errors.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.splitLinework';

/**
 * Splits one LineString object into two new objects and soft-deletes the
 * original — recreating object identity this way, rather than mutating the
 * original in place, is why this command's inverse cannot be a single
 * command (see `packages/geometry-contracts/src/inverse-command.ts`).
 */
export class SplitMapObjectLinework {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: SplitLineworkPayload,
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
      const original = await context.mapObjects.findByIdWithDetails(gardenId, payload.objectId);
      if (original === null) {
        throw mapObjectNotFoundError();
      }
      if (original.currentRevision !== payload.expectedRevision) {
        throw mapObjectStaleRevisionError(original.currentRevision);
      }

      const [firstGeometry, secondGeometry] = splitLineString(
        original.geometry,
        payload.atVertexIndex,
      );
      requireValidGeometryForCategory(original.category, firstGeometry);
      requireValidGeometryForCategory(original.category, secondGeometry);

      const deletedOriginal = transitionMapObjectLifecycle(original, 'deleted', now);
      const appliedDelete = await context.mapObjects.update(
        deletedOriginal,
        original.currentRevision,
      );
      if (!appliedDelete) {
        throw mapObjectStaleRevisionError(original.currentRevision);
      }

      const [firstId, secondId] = payload.resultObjectIds;
      const first: MapObject = {
        ...original,
        id: firstId,
        geometry: firstGeometry,
        currentRevision: 1,
        lifecycleState: 'active',
        createdByProfileId: profileId,
        createdAt: now,
        updatedAt: now,
      };
      const second: MapObject = {
        ...original,
        id: secondId,
        geometry: secondGeometry,
        currentRevision: 1,
        lifecycleState: 'active',
        createdByProfileId: profileId,
        createdAt: now,
        updatedAt: now,
      };

      await context.mapObjects.insert(first);
      await context.mapObjects.insert(second);

      for (const result of [
        { object: deletedOriginal, operation: 'delete' as const },
        { object: first, operation: 'upsert' as const },
        { object: second, operation: 'upsert' as const },
      ]) {
        await context.revisionJournal.record({
          gardenObjectId: result.object.id,
          revision: result.object.currentRevision,
          commandType: 'splitLinework',
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
        eventType: 'mapObject.split',
        aggregateType: 'gardenObject',
        aggregateId: original.id,
        payload: { gardenId, resultObjectIds: [first.id, second.id] },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.split',
        subjectType: 'gardenObject',
        subjectId: original.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return {
        affectedObjects: [deletedOriginal, first, second].map(toGardenObjectResource),
      };
    });
  }
}
