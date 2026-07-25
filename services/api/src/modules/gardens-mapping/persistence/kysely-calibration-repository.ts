import type {
  CalibrationControlPoint,
  ManualCalibrationAdjustment,
  PlanKnownDistance,
} from '@verdery/geometry-contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  Calibration,
  CalibrationRepository,
  LegacyCalibrationReferencePoint,
} from '../application/calibration-repository.js';
import { translateCheckViolation } from './translate-check-violation.js';

interface CalibrationRow {
  id: string;
  background_object_id: string;
  revision: number;
  reference_points: unknown;
  known_distance: unknown;
  page_aspect_ratio: number | null;
  manual_adjustment: unknown;
  metres_per_plan_unit: number | null;
  rotation_radians: number | null;
  translation_x_metres: number | null;
  translation_y_metres: number | null;
  point_residuals_metres: unknown;
  residual_error_metres: number | null;
  created_by_profile_id: string;
  created_at: Date;
}

function toCalibration(row: CalibrationRow): Calibration {
  return {
    id: row.id,
    backgroundObjectId: row.background_object_id,
    revision: row.revision,
    referencePoints: row.reference_points as readonly (
      CalibrationControlPoint | LegacyCalibrationReferencePoint
    )[],
    knownDistance: row.known_distance as PlanKnownDistance | null,
    pageAspectRatio: row.page_aspect_ratio,
    manualAdjustment: row.manual_adjustment as ManualCalibrationAdjustment | null,
    // The migration's `calibration_transform_atomic_check` guarantees the
    // four transform columns are set together or not at all.
    transform:
      row.metres_per_plan_unit === null ||
      row.rotation_radians === null ||
      row.translation_x_metres === null ||
      row.translation_y_metres === null
        ? null
        : {
            metresPerPlanUnit: row.metres_per_plan_unit,
            rotationRadians: row.rotation_radians,
            translationMetres: { x: row.translation_x_metres, y: row.translation_y_metres },
          },
    pointResidualsMetres: row.point_residuals_metres as readonly number[] | null,
    residualErrorMetres: row.residual_error_metres,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
  };
}

export class KyselyCalibrationRepository implements CalibrationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findLatestForBackground(backgroundObjectId: Uuid): Promise<Calibration | null> {
    const map = await this.findLatestForBackgrounds([backgroundObjectId]);
    return map.get(backgroundObjectId) ?? null;
  }

  async findLatestForBackgrounds(
    backgroundObjectIds: readonly Uuid[],
  ): Promise<Map<Uuid, Calibration>> {
    const result = new Map<Uuid, Calibration>();
    if (backgroundObjectIds.length === 0) {
      return result;
    }

    const rows = await this.db
      .selectFrom('gardens_mapping.calibration')
      .selectAll()
      .distinctOn('background_object_id')
      .where('background_object_id', 'in', backgroundObjectIds)
      .orderBy('background_object_id')
      .orderBy('revision', 'desc')
      .execute();

    for (const row of rows) {
      result.set(row.background_object_id, toCalibration(row));
    }
    return result;
  }

  async findById(id: Uuid): Promise<Calibration | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.calibration')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toCalibration(row);
  }

  async insert(calibration: Calibration): Promise<void> {
    try {
      await this.db
        .insertInto('gardens_mapping.calibration')
        .values({
          id: calibration.id,
          background_object_id: calibration.backgroundObjectId,
          revision: calibration.revision,
          // Every jsonb write in this service is explicitly JSON.stringify'd
          // rather than relying on the driver to serialize a plain object —
          // see platform-schema.ts's `JsonValue` doc comment.
          reference_points: JSON.stringify(calibration.referencePoints),
          known_distance:
            calibration.knownDistance === null ? null : JSON.stringify(calibration.knownDistance),
          page_aspect_ratio: calibration.pageAspectRatio,
          manual_adjustment:
            calibration.manualAdjustment === null
              ? null
              : JSON.stringify(calibration.manualAdjustment),
          metres_per_plan_unit: calibration.transform?.metresPerPlanUnit ?? null,
          rotation_radians: calibration.transform?.rotationRadians ?? null,
          translation_x_metres: calibration.transform?.translationMetres.x ?? null,
          translation_y_metres: calibration.transform?.translationMetres.y ?? null,
          point_residuals_metres:
            calibration.pointResidualsMetres === null
              ? null
              : JSON.stringify(calibration.pointResidualsMetres),
          residual_error_metres: calibration.residualErrorMetres,
          created_by_profile_id: calibration.createdByProfileId,
          created_at: calibration.createdAt,
        })
        .execute();
    } catch (error) {
      const translated = translateCheckViolation(error, '/referencePoints');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }
}
