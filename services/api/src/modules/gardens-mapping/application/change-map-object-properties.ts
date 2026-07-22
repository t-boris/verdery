import type { ChangePropertiesPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireMatchingCategoryDetails } from './validate-category-details.js';
import { requireGateReferencesExistingFence } from './validate-gate-fence-reference.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.changeProperties';

/** Label and/or category-specific detail changes. Geometry is untouched — that is `replaceGeometry`'s job. */
export class ChangeMapObjectProperties {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: ChangePropertiesPayload,
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
      await requireGateReferencesExistingFence(
        context.mapObjects,
        gardenId,
        payload.categoryDetails,
      );
      const changed = await applyMapObjectRevisionGuardedUpdate(
        context.mapObjects,
        gardenId,
        payload.objectId,
        payload.expectedRevision,
        (object) => {
          requireMatchingCategoryDetails(object.category, payload.categoryDetails);
          return {
            ...object,
            label: payload.label !== undefined ? payload.label : object.label,
            details:
              payload.categoryDetails !== undefined ? payload.categoryDetails : object.details,
            currentRevision: object.currentRevision + 1,
            updatedAt: now,
          };
        },
      );

      await context.revisionJournal.record({
        gardenObjectId: changed.id,
        revision: changed.currentRevision,
        commandType: 'changeProperties',
        geometry: null,
        label: changed.label,
        lifecycleState: changed.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: changed.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: changed.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.propertiesChanged',
        aggregateType: 'gardenObject',
        aggregateId: changed.id,
        payload: { gardenId },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.propertiesChanged',
        subjectType: 'gardenObject',
        subjectId: changed.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(changed)] };
    });
  }
}
