import type { Position } from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface CalibrationReferencePoint {
  readonly imagePixel: Position;
  readonly localMetres: Position;
}

export interface Calibration {
  readonly id: Uuid;
  readonly backgroundObjectId: Uuid;
  readonly revision: number;
  readonly referencePoints: readonly CalibrationReferencePoint[];
  /** `null` this pass — see the comment on `UpsertMapCalibration` for why residual error is not computed yet. */
  readonly residualErrorMetres: number | null;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
}

/**
 * Recalibration creates a new background transform revision rather than
 * updating a row in place — see the migration's comment on
 * `gardens_mapping.calibration` — so this repository has no `update`.
 */
export interface CalibrationRepository {
  findLatestForBackground(backgroundObjectId: Uuid): Promise<Calibration | null>;
  /** Looks up one calibration revision by its own id — added for `GetCalibration` (P5-BE-02), which needs a specific past revision, not necessarily the latest one, for a `platform.sync_change` row that may no longer name the background's current revision. */
  findById(id: Uuid): Promise<Calibration | null>;
  insert(calibration: Calibration): Promise<void>;
}
