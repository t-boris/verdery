/**
 * Read path for `importedBackground` details (split out of
 * `map-object-details.ts` for the file-size limit): the detail row itself
 * plus, for a calibrated background, the server-owned `calibration` block
 * sourced from the background's LATEST `gardens_mapping.calibration`
 * revision. The calibration table is the single storage of transforms —
 * the details table stores only the state flag — so state and transform
 * cannot drift apart; both are written in one transaction by
 * `UpsertMapCalibration`, the only writer of either.
 */

import type {
  CalibratedReferencePoint,
  CalibrationControlPoint,
  ImportedBackgroundCalibration,
  ImportedBackgroundDetails,
  GardenObjectDetails,
} from '@verdery/geometry-contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Calibration } from '../application/calibration-repository.js';
import { KyselyCalibrationRepository } from './kysely-calibration-repository.js';

/**
 * Builds the wire/domain `calibration` block from a stored calibration
 * revision. Returns `undefined` for a legacy P3-shaped row (no derivation
 * stored) — unreachable for any background the reworked command
 * calibrated, since state and a complete row are written atomically, but
 * an honest `undefined` beats fabricating a transform if the invariant is
 * ever violated by hand-edited data.
 */
function toCalibrationBlock(calibration: Calibration): ImportedBackgroundCalibration | undefined {
  if (
    calibration.knownDistance === null ||
    calibration.pageAspectRatio === null ||
    calibration.transform === null
  ) {
    return undefined;
  }

  const residuals = calibration.pointResidualsMetres ?? [];
  const referencePoints: CalibratedReferencePoint[] = calibration.referencePoints.map(
    (point, index) => {
      // Rows with a derived transform always carry plan-fraction points;
      // the legacy imagePixel shape exists only on rows this function
      // already returned `undefined` for.
      const control = point as CalibrationControlPoint;
      return {
        planPoint: control.planPoint,
        localMetres: control.localMetres,
        residualMetres: residuals[index] ?? 0,
      };
    },
  );

  return {
    transformRevision: calibration.revision,
    pageAspectRatio: calibration.pageAspectRatio,
    knownDistance: calibration.knownDistance,
    referencePoints,
    ...(calibration.manualAdjustment === null
      ? {}
      : { manualAdjustment: calibration.manualAdjustment }),
    transform: calibration.transform,
    rmsErrorMetres: calibration.residualErrorMetres,
  };
}

/** One batched query for the detail rows plus one for the latest calibration revisions — never N+1. */
export async function fetchImportedBackgroundDetails(
  db: Kysely<DatabaseSchema>,
  objectIds: readonly Uuid[],
): Promise<Map<Uuid, GardenObjectDetails>> {
  const result = new Map<Uuid, GardenObjectDetails>();

  const rows = await db
    .selectFrom('gardens_mapping.imported_background_details')
    .select([
      'garden_object_id',
      'plan_media_id',
      'source_page_number',
      'is_background_visible',
      'calibration_state',
    ])
    .where('garden_object_id', 'in', objectIds)
    .execute();

  const calibratedIds = rows
    .filter((row) => row.calibration_state === 'calibrated')
    .map((row) => row.garden_object_id);
  const calibrations = await new KyselyCalibrationRepository(db).findLatestForBackgrounds(
    calibratedIds,
  );

  for (const row of rows) {
    const latest = calibrations.get(row.garden_object_id);
    const calibration = latest === undefined ? undefined : toCalibrationBlock(latest);
    const details: ImportedBackgroundDetails = {
      planMediaId: row.plan_media_id,
      ...(row.source_page_number === null ? {} : { sourcePageNumber: row.source_page_number }),
      isBackgroundVisible: row.is_background_visible,
      calibrationState: row.calibration_state as ImportedBackgroundDetails['calibrationState'],
      ...(calibration === undefined ? {} : { calibration }),
    };
    result.set(row.garden_object_id, { category: 'importedBackground', details });
  }

  return result;
}
