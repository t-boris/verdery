import type { RestoreObjectPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { transitionMapObjectLifecycle } from '../domain/map-object-lifecycle.js';
import { mapObjectNotFoundError, mapObjectStaleRevisionError } from './map-object-errors.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.restoreObject';

/** The mirror of `DeleteMapObject`: `lifecycle_state → 'active'` — undone through revision restoration, per the same "revision and validity interval" model as garden georeferencing. */
export class RestoreMapObject {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: RestoreObjectPayload,
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
      const object = await context.mapObjects.findByIdWithDetails(gardenId, payload.objectId);
      if (object === null) {
        throw mapObjectNotFoundError();
      }
      if (object.currentRevision !== payload.expectedRevision) {
        throw mapObjectStaleRevisionError(object.currentRevision);
      }

      const restored = transitionMapObjectLifecycle(object, 'active', now);
      const applied = await context.mapObjects.update(restored, object.currentRevision);
      if (!applied) {
        throw mapObjectStaleRevisionError(object.currentRevision);
      }

      await context.revisionJournal.record({
        gardenObjectId: restored.id,
        revision: restored.currentRevision,
        commandType: 'restoreObject',
        geometry: null,
        label: restored.label,
        lifecycleState: restored.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: restored.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: restored.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.restored',
        aggregateType: 'gardenObject',
        aggregateId: restored.id,
        payload: { gardenId },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.restored',
        subjectType: 'gardenObject',
        subjectId: restored.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(restored)] };
    });
  }
}
