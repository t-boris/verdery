import { SharedErrorCode } from '@verdery/api-contracts';
import type {
  ImportedBackgroundCalibration,
  UpsertCalibrationPayload,
} from '@verdery/geometry-contracts';
import {
  CalibrationInputError,
  derivePlanCalibration,
  planPageFootprint,
} from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';
import type { Calibration } from './calibration-repository.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.upsertCalibration';

/**
 * Calibrates (or recalibrates) an imported background (P6-PLAN-02,
 * reworking the P3 scaffold that only recorded reference points).
 *
 * One transaction does all of it, so state and transform can never drift:
 *
 * 1. Derives the similarity transform, per-point residuals, and aggregate
 *    RMS from the submitted inputs via the shared `derivePlanCalibration`
 *    — the same math every client runs for its live preview, pinned by
 *    the shared calibration fixtures.
 * 2. Inserts a NEW `gardens_mapping.calibration` revision ("recalibration
 *    creates a new background transform revision", section 16) carrying
 *    inputs and derivation. `residual_error_metres` — the column P3 left
 *    NULL pending exactly this fitting math — is now the real RMS (still
 *    honestly `null` below two control points).
 * 3. Rewrites the background object itself, revision-guarded like every
 *    other mutating command: `calibrationState` flips to `'calibrated'`
 *    and the placeholder geometry is replaced with the transformed page
 *    footprint, so the selectable outline and the rendered plan imagery
 *    coincide by construction.
 *
 * Undo: deliberately not single-command undoable (`deriveInverseCommand`
 * returns `null` — the design's own exclusion); the correction path is
 * recalibrating, which the stored inputs make a re-derivation rather than
 * a restart.
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

    const derivation = this.derive(payload);

    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, payload }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();

      const latest = await context.calibrations.findLatestForBackground(payload.backgroundObjectId);
      const transformRevision = (latest?.revision ?? 0) + 1;

      const calibrationBlock: ImportedBackgroundCalibration = {
        transformRevision,
        pageAspectRatio: payload.pageAspectRatio,
        knownDistance: payload.knownDistance,
        referencePoints: payload.referencePoints.map((point, index) => ({
          ...point,
          residualMetres: derivation.pointResidualsMetres[index] ?? 0,
        })),
        ...(payload.manualAdjustment === undefined
          ? {}
          : { manualAdjustment: payload.manualAdjustment }),
        transform: derivation.transform,
        rmsErrorMetres: derivation.rmsErrorMetres,
      };
      const footprint = planPageFootprint(derivation.transform, payload.pageAspectRatio);

      const changed = await applyMapObjectRevisionGuardedUpdate(
        context.mapObjects,
        gardenId,
        payload.backgroundObjectId,
        payload.expectedRevision,
        (object) => {
          if (object.details?.category !== 'importedBackground') {
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
          return {
            ...object,
            geometry: footprint,
            details: {
              category: 'importedBackground',
              details: {
                ...object.details.details,
                calibrationState: 'calibrated',
                // `writeDetails` persists only the state flag; this block
                // is stored once, in the calibration row inserted below.
                // Carrying it here keeps the returned resource identical
                // to what the next read's calibration join would produce.
                calibration: calibrationBlock,
              },
            },
            currentRevision: object.currentRevision + 1,
            updatedAt: now,
          };
        },
      );

      const calibration: Calibration = {
        id: generateUuidV7(),
        backgroundObjectId: changed.id,
        revision: transformRevision,
        referencePoints: payload.referencePoints,
        knownDistance: payload.knownDistance,
        pageAspectRatio: payload.pageAspectRatio,
        manualAdjustment: payload.manualAdjustment ?? null,
        transform: derivation.transform,
        pointResidualsMetres: derivation.pointResidualsMetres,
        residualErrorMetres: derivation.rmsErrorMetres,
        createdByProfileId: profileId,
        createdAt: now,
      };
      await context.calibrations.insert(calibration);

      await context.revisionJournal.record({
        gardenObjectId: changed.id,
        revision: changed.currentRevision,
        commandType: 'upsertCalibration',
        geometry: changed.geometry,
        label: changed.label,
        lifecycleState: changed.lifecycleState,
        actorProfileId: profileId,
      });
      // Two sync records on purpose: the calibration history entry itself,
      // and the background object whose details/geometry this command
      // rewrote — an offline client consuming only gardenObject upserts
      // still receives the current transform.
      await context.syncChanges.record({
        gardenId,
        recordId: calibration.id,
        recordType: 'calibration',
        operation: 'upsert',
        recordRevision: calibration.revision,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: changed.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: changed.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapCalibration.upserted',
        aggregateType: 'calibration',
        aggregateId: calibration.id,
        payload: { gardenId, backgroundObjectId: changed.id, revision: calibration.revision },
      });
      await context.auditLogger.record({
        eventType: 'mapCalibration.upserted',
        subjectType: 'calibration',
        subjectId: calibration.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(changed)] };
    });
  }

  /** Runs the shared derivation, translating its typed input error into this service's validation shape. */
  private derive(payload: UpsertCalibrationPayload) {
    try {
      return derivePlanCalibration({
        pageAspectRatio: payload.pageAspectRatio,
        knownDistance: payload.knownDistance,
        referencePoints: payload.referencePoints,
        ...(payload.manualAdjustment === undefined
          ? {}
          : { manualAdjustment: payload.manualAdjustment }),
      });
    } catch (error) {
      if (error instanceof CalibrationInputError) {
        throw new ValidationError(SharedErrorCode.RequestInvalid, error.message, {
          details: [
            {
              code: `map.upsert_calibration.${error.code}`,
              pointer: `/payload${error.pointer}`,
            },
          ],
        });
      }
      throw error;
    }
  }
}
