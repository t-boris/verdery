import { SharedErrorCode } from '@verdery/api-contracts';
import type { UpsertCalibrationPayload } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { Calibration } from './calibration-repository.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { mapObjectNotFoundError } from './map-object-errors.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.upsertCalibration';

/**
 * Records a new calibration revision for an imported background image.
 * Recalibration is a new row, not an update — "recalibration creates a new
 * background transform revision" per the migration's comment on
 * `gardens_mapping.calibration` — so this command carries no
 * `expectedRevision` and does not touch `garden_object.current_revision` or
 * write a `garden_object_revision` entry: nothing about the background
 * object itself changed, only its calibration history gained an entry.
 *
 * TODO(residual error): `residualErrorMetres` is left `null` — computing it
 * needs a best-fit local-to-image transform and its resulting error, a
 * numerical-fitting problem outside this pass's scope. `null` ("not
 * expressed") is the honest value here, not a fabricated number.
 */
export class UpsertMapCalibration {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: UpsertCalibrationPayload,
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
      const background = await context.mapObjects.findByIdWithDetails(
        gardenId,
        payload.backgroundObjectId,
      );
      if (background === null) {
        throw mapObjectNotFoundError();
      }
      if (background.category !== 'importedBackground') {
        throw new ValidationError(
          SharedErrorCode.RequestInvalid,
          'backgroundObjectId must reference an importedBackground object.',
          {
            details: [
              {
                code: 'map.upsert_calibration.not_a_background',
                pointer: '/payload/backgroundObjectId',
              },
            ],
          },
        );
      }

      const latest = await context.calibrations.findLatestForBackground(background.id);
      const calibration: Calibration = {
        id: generateUuidV7(),
        backgroundObjectId: background.id,
        revision: (latest?.revision ?? 0) + 1,
        referencePoints: payload.referencePoints,
        residualErrorMetres: null,
        createdByProfileId: profileId,
        createdAt: now,
      };
      await context.calibrations.insert(calibration);

      await context.syncChanges.record({
        gardenId,
        recordId: calibration.id,
        recordType: 'calibration',
        operation: 'upsert',
        recordRevision: calibration.revision,
      });
      await context.outbox.append({
        eventType: 'mapCalibration.upserted',
        aggregateType: 'calibration',
        aggregateId: calibration.id,
        payload: { gardenId, backgroundObjectId: background.id, revision: calibration.revision },
      });
      await context.auditLogger.record({
        eventType: 'mapCalibration.upserted',
        subjectType: 'calibration',
        subjectId: calibration.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(background)] };
    });
  }
}
