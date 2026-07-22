import { SharedErrorCode } from '@verdery/api-contracts';
import type { AssignPlantPayload, PlantPlacementDetails } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.assignPlant';

function invalidTarget(): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'targetObjectId must reference an existing, active zone or bed object in this garden.',
    { details: [{ code: 'map.assign_plant.invalid_target', pointer: '/payload/targetObjectId' }] },
  );
}

function notAPlant(): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'assignPlant requires a plant object.',
    {
      details: [{ code: 'map.assign_plant.not_a_plant', pointer: '/payload/plantObjectId' }],
    },
  );
}

/**
 * Assigns (or, with `targetObjectId: null`, unassigns) a plant to a zone or
 * bed. `targetObjectId`'s existence and category are validated here — one of
 * the two reference checks this work package's validation pass names
 * explicitly (the other is `gate.fenceObjectId`, in `CreateMapObject`'s and
 * `ChangeMapObjectProperties`' shared `categoryDetails` path via the database
 * foreign key on `gate_details.fence_object_id`, translated the same way
 * geometry checks are — see `translate-check-violation.ts`).
 */
export class AssignPlantToTarget {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: AssignPlantPayload,
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

      if (payload.targetObjectId !== null) {
        const target = await context.mapObjects.findById(gardenId, payload.targetObjectId);
        const targetIsZoneOrBed = target?.category === 'zone' || target?.category === 'bed';
        if (target === null || !targetIsZoneOrBed || target.lifecycleState !== 'active') {
          throw invalidTarget();
        }
      }

      const assigned = await applyMapObjectRevisionGuardedUpdate(
        context.mapObjects,
        gardenId,
        payload.plantObjectId,
        payload.expectedRevision,
        (object) => {
          if (
            object.category !== 'plant' ||
            object.details === undefined ||
            object.details.category !== 'plant'
          ) {
            throw notAPlant();
          }
          const existing = object.details.details;
          const details: PlantPlacementDetails = {
            commonName: existing.commonName,
            quantity: existing.quantity,
            ...(existing.spacingMetres === undefined
              ? {}
              : { spacingMetres: existing.spacingMetres }),
            ...(payload.targetObjectId === null
              ? {}
              : { assignedToObjectId: payload.targetObjectId }),
          };
          return {
            ...object,
            details: { category: 'plant', details },
            currentRevision: object.currentRevision + 1,
            updatedAt: now,
          };
        },
      );

      await context.revisionJournal.record({
        gardenObjectId: assigned.id,
        revision: assigned.currentRevision,
        commandType: 'assignPlant',
        geometry: null,
        label: assigned.label,
        lifecycleState: assigned.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: assigned.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: assigned.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.plantAssigned',
        aggregateType: 'gardenObject',
        aggregateId: assigned.id,
        payload: { gardenId, targetObjectId: payload.targetObjectId },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.plantAssigned',
        subjectType: 'gardenObject',
        subjectId: assigned.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(assigned)] };
    });
  }
}
