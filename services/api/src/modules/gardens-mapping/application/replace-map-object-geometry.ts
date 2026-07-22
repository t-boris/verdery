import type { ReplaceGeometryPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.replaceGeometry';

/** What a resize, rotate, or freehand reshape gesture commits as — the domain does not care how a client derived the new shape, only what it is. */
export class ReplaceMapObjectGeometry {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: ReplaceGeometryPayload,
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
      const replaced = await applyMapObjectRevisionGuardedUpdate(
        context.mapObjects,
        gardenId,
        payload.objectId,
        payload.expectedRevision,
        (object) => {
          requireValidGeometryForCategory(object.category, payload.geometry);
          return {
            ...object,
            geometry: payload.geometry,
            currentRevision: object.currentRevision + 1,
            updatedAt: now,
          };
        },
      );

      await context.revisionJournal.record({
        gardenObjectId: replaced.id,
        revision: replaced.currentRevision,
        commandType: 'replaceGeometry',
        geometry: replaced.geometry,
        label: replaced.label,
        lifecycleState: replaced.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: replaced.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: replaced.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.geometryReplaced',
        aggregateType: 'gardenObject',
        aggregateId: replaced.id,
        payload: { gardenId },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.geometryReplaced',
        subjectType: 'gardenObject',
        subjectId: replaced.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(replaced)] };
    });
  }
}
