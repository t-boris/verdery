/**
 * Measurements and their uncertainty.
 *
 * The schema must not imply survey accuracy merely because a value uses a
 * precise numeric type — every measurement therefore carries how it was
 * acquired, so a UI can present "user-entered" and "AR-measured" distances
 * differently even though both are stored as the same SI number.
 *
 * Source: architecture/data-and-geospatial-design.md, section
 * "11. Measurements and Uncertainty".
 */

export type MeasurementUnit = 'metres' | 'squareMetres' | 'degrees';

export type MeasurementAcquisitionMethod =
  | 'userEntered'
  | 'derivedFromGeometry'
  | 'arMeasurement'
  | 'imageExtraction'
  | 'depthCapture'
  | 'importedPlan';

export interface Measurement {
  /** Canonical SI value — metres, square metres, or degrees per {@link MeasurementUnit}. */
  readonly value: number;
  readonly unit: MeasurementUnit;
  readonly acquisitionMethod: MeasurementAcquisitionMethod;
  /** As the user typed it, before conversion to the canonical unit — e.g. "40 ft". Absent when the value was derived, not entered. */
  readonly originalEntry?: string;
  /** Absolute uncertainty in the same unit as {@link value}. Absent means "not expressed", not "exact". */
  readonly uncertainty?: number;
  /** The object or segment this measurement is relative to, when it is not a standalone entry. */
  readonly referenceObjectId?: string;
  /** The calibration revision this measurement was computed under, when derived from an imported, calibrated plan. */
  readonly calibrationRevision?: number;
}
