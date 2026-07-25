import type {
  CalibrationControlPoint,
  ManualCalibrationAdjustment,
  PlanKnownDistance,
  PlanTransform,
  Position,
} from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** The P3 reference-point shape legacy rows carry — image pixels, not plan fractions. Kept only so old rows stay readable. */
export interface LegacyCalibrationReferencePoint {
  readonly imagePixel: Position;
  readonly localMetres: Position;
}

/**
 * One calibration revision: the full inputs the user supplied (so
 * recalibration can re-derive and the UI can re-display them) plus the
 * derived transform and residuals (P6-PLAN-02).
 *
 * Every field marked "legacy rows: null/absent" is nullable only because a
 * P3-shaped row (reference points alone, no derivation — see the
 * background-calibration-transform migration) may still exist; the
 * reworked `upsertCalibration` command always writes the complete set.
 */
export interface Calibration {
  readonly id: Uuid;
  readonly backgroundObjectId: Uuid;
  readonly revision: number;
  readonly referencePoints: readonly (CalibrationControlPoint | LegacyCalibrationReferencePoint)[];
  /** Legacy rows: null. */
  readonly knownDistance: PlanKnownDistance | null;
  /** Legacy rows: null. */
  readonly pageAspectRatio: number | null;
  readonly manualAdjustment: ManualCalibrationAdjustment | null;
  /** Legacy rows: null. */
  readonly transform: PlanTransform | null;
  /** Aligned index-for-index with `referencePoints`. Legacy rows: null. */
  readonly pointResidualsMetres: readonly number[] | null;
  /** Aggregate RMS. `null` below two control points ("not expressed"), and on every legacy row. */
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
  /** Batched latest-revision lookup for the details read path — one query for a whole map fetch, never N+1. */
  findLatestForBackgrounds(backgroundObjectIds: readonly Uuid[]): Promise<Map<Uuid, Calibration>>;
  /** Looks up one calibration revision by its own id — added for `GetCalibration` (P5-BE-02), which needs a specific past revision, not necessarily the latest one, for a `platform.sync_change` row that may no longer name the background's current revision. */
  findById(id: Uuid): Promise<Calibration | null>;
  insert(calibration: Calibration): Promise<void>;
}
