import type { EditVertexPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { applyVertexOperation } from '../domain/geometry-edit.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.editVertex';

export class EditMapObjectVertex {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: EditVertexPayload,
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
      const edited = await applyMapObjectRevisionGuardedUpdate(
        context.mapObjects,
        gardenId,
        payload.objectId,
        payload.expectedRevision,
        (object) => {
          const geometry = applyVertexOperation(
            object.geometry,
            payload.ringIndex,
            payload.vertexIndex,
            payload.operation,
            payload.position,
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
        gardenObjectId: edited.id,
        revision: edited.currentRevision,
        commandType: 'editVertex',
        geometry: edited.geometry,
        label: edited.label,
        lifecycleState: edited.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: edited.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: edited.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.vertexEdited',
        aggregateType: 'gardenObject',
        aggregateId: edited.id,
        payload: {
          gardenId,
          operation: payload.operation,
          ringIndex: payload.ringIndex,
          vertexIndex: payload.vertexIndex,
        },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.vertexEdited',
        subjectType: 'gardenObject',
        subjectId: edited.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(edited)] };
    });
  }
}
