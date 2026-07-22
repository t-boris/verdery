import type { DeleteObjectPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { transitionMapObjectLifecycle } from '../domain/map-object-lifecycle.js';
import { mapObjectNotFoundError, mapObjectStaleRevisionError } from './map-object-errors.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.deleteObject';

/**
 * Soft-deletes an object: `lifecycle_state → 'deleted'`, geometry and
 * details untouched, still recoverable via `restoreObject`.
 *
 * TODO(cross-object validation): deleting a fence with an attached gate
 * currently succeeds silently, leaving `gate_details.fence_object_id`
 * pointing at a deleted fence — architecture/map-rendering-and-editing.md
 * section "11. Validation" calls this out as "detached gate" validation that
 * belongs to this command. It needs a query for dependent objects this work
 * package does not implement; faking it with a check that always passes
 * would be worse than the honest gap this comment documents.
 */
export class DeleteMapObject {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: DeleteObjectPayload,
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

      const deleted = transitionMapObjectLifecycle(object, 'deleted', now);
      const applied = await context.mapObjects.update(deleted, object.currentRevision);
      if (!applied) {
        throw mapObjectStaleRevisionError(object.currentRevision);
      }

      await context.revisionJournal.record({
        gardenObjectId: deleted.id,
        revision: deleted.currentRevision,
        commandType: 'deleteObject',
        geometry: null,
        label: deleted.label,
        lifecycleState: deleted.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: deleted.id,
        recordType: 'gardenObject',
        operation: 'delete',
        recordRevision: deleted.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.deleted',
        aggregateType: 'gardenObject',
        aggregateId: deleted.id,
        payload: { gardenId },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.deleted',
        subjectType: 'gardenObject',
        subjectId: deleted.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(deleted)] };
    });
  }
}
