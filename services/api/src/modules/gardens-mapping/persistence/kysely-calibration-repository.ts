import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  Calibration,
  CalibrationReferencePoint,
  CalibrationRepository,
} from '../application/calibration-repository.js';
import { translateCheckViolation } from './translate-check-violation.js';

interface CalibrationRow {
  id: string;
  background_object_id: string;
  revision: number;
  reference_points: unknown;
  residual_error_metres: number | null;
  created_by_profile_id: string;
  created_at: Date;
}

function toCalibration(row: CalibrationRow): Calibration {
  return {
    id: row.id,
    backgroundObjectId: row.background_object_id,
    revision: row.revision,
    referencePoints: row.reference_points as readonly CalibrationReferencePoint[],
    residualErrorMetres: row.residual_error_metres,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
  };
}

export class KyselyCalibrationRepository implements CalibrationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findLatestForBackground(backgroundObjectId: Uuid): Promise<Calibration | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.calibration')
      .selectAll()
      .where('background_object_id', '=', backgroundObjectId)
      .orderBy('revision', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? null : toCalibration(row);
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
