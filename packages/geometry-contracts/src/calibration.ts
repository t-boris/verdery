/**
 * Plan-background calibration: the plan-space -> local-space transform an
 * imported background acquires when the user calibrates it, and the math
 * that derives it from calibration inputs.
 *
 * Coordinate conventions
 * ----------------------
 * Plan space is measured in "plan-fraction" units: a plan point is
 * `[u, v]` where `u = xPixels / imageWidthPixels` and
 * `v = yPixels / imageWidthPixels` of whichever raster rendition of the
 * page the client displayed. Both axes divide by the WIDTH, so the unit is
 * isotropic (one plan unit is the page's full width in either direction)
 * and the representation is resolution-independent: the 1,600 px screen
 * preview, the 4,096 px high-resolution image, and the tile pyramid all
 * preserve the page's aspect ratio (P6-WORKER-02), so the same `[u, v]`
 * names the same ink on any of them. `u` runs 0..1 left to right; `v` runs
 * 0..`pageAspectRatio` top to bottom (image convention, y down).
 * Original-pixel coordinates were rejected because the API deliberately
 * does not expose raster dimensions, so no client could compute them.
 *
 * The transform is a SIMILARITY transform - uniform scale, rotation,
 * translation - exactly the degrees of freedom section 16 of the map
 * design names ("one known-distance segment for uniform scale", "control
 * points for rotation"). A full 6-DOF affine (shear, anisotropic scale) is
 * deliberately not modeled: it would absorb input noise and paper
 * distortion into fake shear terms, manufacturing precision the product
 * must not claim ("prevents false precision").
 *
 * Applying the transform converts image y-down to local y-up once, here:
 *
 *   local = translationMetres + metresPerPlanUnit * R(rotationRadians) * (u, -v)
 *
 * Derivation
 * ----------
 * - Scale comes from the known-distance segment alone.
 * - Rotation and translation come from a least-squares rigid fit (2D
 *   Kabsch with the scale held fixed) over the control points: zero
 *   control points leave rotation 0 and translation (0, 0); one control
 *   point pins translation only.
 * - The optional manual adjustment - "manual origin and orientation
 *   adjustment" (section 16) - composes ON TOP of the fitted transform in
 *   local space: rotate about the local origin by `rotationRadians`, then
 *   translate by `translationMetres`.
 * - Residuals are each control point's distance in metres between its
 *   mapped plan point and its stated local point, measured against the
 *   FINAL (manually adjusted, rounded) transform - the placement the user
 *   actually sees. The aggregate RMS is `null` below two control points:
 *   a one-point fit is exact by construction, and reporting "0 error" for
 *   it would be exactly the false precision section 16 forbids.
 *
 * Determinism: derived numbers are rounded on fixed decimal grids (the
 * same reasoning as ADR-0010's coordinate rounding) so every runtime
 * produces byte-identical output for the shared calibration fixtures in
 * `packages/test-fixtures`.
 *
 * Source: architecture/map-rendering-and-editing.md, section "16. Plan
 * Import and Calibration"; architecture/garden-capture-and-scan.md,
 * section "8. Plan Import Flow"; ADR-0010.
 */

import type { Geometry, Position } from './geometry.js';
import { roundCoordinate, roundPosition } from './rounding.js';
import { MAXIMUM_COORDINATE_MAGNITUDE_METRES } from './tolerances.js';

/** Two points on the plan and the real-world distance between them - the uniform-scale source. */
export interface PlanKnownDistance {
  readonly pointA: Position;
  readonly pointB: Position;
  readonly distanceMetres: number;
}

/** One plan point paired with the local-space point it must land on. */
export interface CalibrationControlPoint {
  readonly planPoint: Position;
  readonly localMetres: Position;
}

/** User-applied correction on top of the fitted transform: rotate about the local origin, then translate. */
export interface ManualCalibrationAdjustment {
  readonly rotationRadians: number;
  readonly translationMetres: { readonly dx: number; readonly dy: number };
}

/** The derived plan-space -> local-space similarity transform. See the module doc comment for the exact formula. */
export interface PlanTransform {
  /** Metres per plan-fraction unit, i.e. the page's full width in metres. Always > 0. */
  readonly metresPerPlanUnit: number;
  /** Counter-clockwise rotation in local space, normalized to (-pi, pi]. */
  readonly rotationRadians: number;
  readonly translationMetres: { readonly x: number; readonly y: number };
}

export interface PlanCalibrationInput {
  /** Page height / page width. Bounds `v` and shapes the page footprint. */
  readonly pageAspectRatio: number;
  readonly knownDistance: PlanKnownDistance;
  readonly referencePoints: readonly CalibrationControlPoint[];
  readonly manualAdjustment?: ManualCalibrationAdjustment;
}

export interface PlanCalibrationDerivation {
  readonly transform: PlanTransform;
  /** One residual per control point, in input order, metres. */
  readonly pointResidualsMetres: readonly number[];
  /** `null` ("not expressed") below two control points - see the module doc comment. */
  readonly rmsErrorMetres: number | null;
}

export type CalibrationInputIssueCode =
  | 'page_aspect_ratio_invalid'
  | 'known_distance_not_positive'
  | 'known_distance_segment_degenerate'
  | 'plan_point_outside_page'
  | 'local_point_out_of_range'
  | 'control_points_too_many'
  | 'manual_adjustment_invalid';

/** Raised when calibration inputs cannot produce an honest transform. `pointer` is relative to the input root. */
export class CalibrationInputError extends Error {
  constructor(
    public readonly code: CalibrationInputIssueCode,
    public readonly pointer: string,
    message: string,
  ) {
    super(message);
    this.name = 'CalibrationInputError';
  }
}

/** Plausibility bound for a page's height/width ratio - a real property plan is never a 64:1 strip. */
export const MAXIMUM_PAGE_ASPECT_RATIO = 64;
/** Shortest usable known-distance segment, in plan-fraction units (0.1% of the page width). */
export const MINIMUM_KNOWN_DISTANCE_SEGMENT_PLAN_UNITS = 0.001;
/** More control points than this stops improving a 4-DOF fit and starts looking like an import, not a calibration. */
export const MAXIMUM_CONTROL_POINT_COUNT = 32;

/** Rounding grids for derived values - fixed so shared fixtures compare exactly across runtimes (ADR-0010's reasoning). */
const SCALE_DECIMALS = 6;
const ROTATION_DECIMALS = 9;
const RESIDUAL_DECIMALS = 4;

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  const scaled = value * scale;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  const result = rounded / scale;
  return result === 0 ? 0 : result;
}

/** Normalizes an angle to (-pi, pi]. */
export function normalizeRotation(radians: number): number {
  const twoPi = 2 * Math.PI;
  let value = radians % twoPi;
  if (value <= -Math.PI) {
    value += twoPi;
  } else if (value > Math.PI) {
    value -= twoPi;
  }
  return value === 0 ? 0 : value;
}

/** Maps a plan-fraction point into local metres through `transform`. */
export function applyPlanTransform(transform: PlanTransform, planPoint: Position): Position {
  const [u, v] = planPoint;
  const cos = Math.cos(transform.rotationRadians);
  const sin = Math.sin(transform.rotationRadians);
  const s = transform.metresPerPlanUnit;
  // R(theta) applied to the y-flipped plan vector (u, -v).
  return [
    transform.translationMetres.x + s * (u * cos + v * sin),
    transform.translationMetres.y + s * (u * sin - v * cos),
  ];
}

/** Inverse of {@link applyPlanTransform}: which plan-fraction point sits at `localPoint`. */
export function planPointForLocal(transform: PlanTransform, localPoint: Position): Position {
  const cos = Math.cos(transform.rotationRadians);
  const sin = Math.sin(transform.rotationRadians);
  const s = transform.metresPerPlanUnit;
  const dx = localPoint[0] - transform.translationMetres.x;
  const dy = localPoint[1] - transform.translationMetres.y;
  // R(-theta) * d / s gives the y-flipped plan vector (u, -v).
  const u = (dx * cos + dy * sin) / s;
  const flippedV = (-dx * sin + dy * cos) / s;
  return [u, -flippedV];
}

/** Translates a transform's placement by a local-space delta. */
export function translatePlanTransform(
  transform: PlanTransform,
  dxMetres: number,
  dyMetres: number,
): PlanTransform {
  return {
    ...transform,
    translationMetres: {
      x: transform.translationMetres.x + dxMetres,
      y: transform.translationMetres.y + dyMetres,
    },
  };
}

/** Rotates a transform's placement by `deltaRadians` about a local-space pivot (e.g. the footprint's center). */
export function rotatePlanTransformAbout(
  transform: PlanTransform,
  pivot: Position,
  deltaRadians: number,
): PlanTransform {
  const cos = Math.cos(deltaRadians);
  const sin = Math.sin(deltaRadians);
  const dx = transform.translationMetres.x - pivot[0];
  const dy = transform.translationMetres.y - pivot[1];
  return {
    metresPerPlanUnit: transform.metresPerPlanUnit,
    rotationRadians: normalizeRotation(transform.rotationRadians + deltaRadians),
    translationMetres: {
      x: pivot[0] + dx * cos - dy * sin,
      y: pivot[1] + dx * sin + dy * cos,
    },
  };
}

/**
 * The manual adjustment that turns `fitted` into `desired` (same scale
 * assumed - a manual adjustment never rescales). This is how a client
 * records "the user dragged/rotated the preview to HERE" as re-derivable
 * input rather than a raw transform overwrite.
 */
export function manualAdjustmentBetween(
  fitted: PlanTransform,
  desired: PlanTransform,
): ManualCalibrationAdjustment {
  const rotation = normalizeRotation(desired.rotationRadians - fitted.rotationRadians);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    rotationRadians: rotation,
    translationMetres: {
      dx:
        desired.translationMetres.x -
        (fitted.translationMetres.x * cos - fitted.translationMetres.y * sin),
      dy:
        desired.translationMetres.y -
        (fitted.translationMetres.x * sin + fitted.translationMetres.y * cos),
    },
  };
}

/**
 * The page rectangle `[0,1] x [0,aspect]` mapped through `transform` as a
 * closed, counter-clockwise local-space Polygon, rounded to the storage
 * grid - the honest footprint geometry a calibrated background object
 * carries instead of its placeholder square.
 */
export function planPageFootprint(transform: PlanTransform, pageAspectRatio: number): Geometry {
  // Bottom-left, bottom-right, top-right, top-left of the PAGE (v is
  // image-down, so v = aspect is the page's bottom edge) - this order is
  // counter-clockwise in y-up local space for any rotation, because a
  // similarity transform with positive scale preserves orientation.
  const corners: readonly Position[] = [
    [0, pageAspectRatio],
    [1, pageAspectRatio],
    [1, 0],
    [0, 0],
  ];
  const ring = corners.map((corner) => roundPosition(applyPlanTransform(transform, corner)));
  const first = ring[0] as Position;
  return { type: 'Polygon', coordinates: [[...ring, first]] };
}

function requireFinitePlanPoint(point: Position, aspect: number, pointer: string): void {
  const [u, v] = point;
  const inPage =
    Number.isFinite(u) && Number.isFinite(v) && u >= 0 && u <= 1 && v >= 0 && v <= aspect;
  if (!inPage) {
    throw new CalibrationInputError(
      'plan_point_outside_page',
      pointer,
      `${pointer} must lie on the page: u in [0, 1], v in [0, ${String(aspect)}].`,
    );
  }
}

function requireLocalPoint(point: Position, pointer: string): void {
  const inRange = point.every(
    (value) => Number.isFinite(value) && Math.abs(value) <= MAXIMUM_COORDINATE_MAGNITUDE_METRES,
  );
  if (!inRange) {
    throw new CalibrationInputError(
      'local_point_out_of_range',
      pointer,
      `${pointer} must be finite local coordinates within ` +
        `±${String(MAXIMUM_COORDINATE_MAGNITUDE_METRES)} m.`,
    );
  }
}

function validateInput(input: PlanCalibrationInput): void {
  const aspect = input.pageAspectRatio;
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect > MAXIMUM_PAGE_ASPECT_RATIO) {
    throw new CalibrationInputError(
      'page_aspect_ratio_invalid',
      '/pageAspectRatio',
      `/pageAspectRatio must be a finite ratio in (0, ${String(MAXIMUM_PAGE_ASPECT_RATIO)}].`,
    );
  }

  const { pointA, pointB, distanceMetres } = input.knownDistance;
  requireFinitePlanPoint(pointA, aspect, '/knownDistance/pointA');
  requireFinitePlanPoint(pointB, aspect, '/knownDistance/pointB');
  if (
    !Number.isFinite(distanceMetres) ||
    distanceMetres <= 0 ||
    distanceMetres > MAXIMUM_COORDINATE_MAGNITUDE_METRES
  ) {
    throw new CalibrationInputError(
      'known_distance_not_positive',
      '/knownDistance/distanceMetres',
      '/knownDistance/distanceMetres must be a positive distance in metres ' +
        `no greater than ${String(MAXIMUM_COORDINATE_MAGNITUDE_METRES)}.`,
    );
  }
  if (
    Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]) <
    MINIMUM_KNOWN_DISTANCE_SEGMENT_PLAN_UNITS
  ) {
    throw new CalibrationInputError(
      'known_distance_segment_degenerate',
      '/knownDistance',
      'The known-distance segment is too short to derive a scale from.',
    );
  }

  if (input.referencePoints.length > MAXIMUM_CONTROL_POINT_COUNT) {
    throw new CalibrationInputError(
      'control_points_too_many',
      '/referencePoints',
      `At most ${String(MAXIMUM_CONTROL_POINT_COUNT)} control points are supported.`,
    );
  }
  input.referencePoints.forEach((point, index) => {
    requireFinitePlanPoint(point.planPoint, aspect, `/referencePoints/${String(index)}/planPoint`);
    requireLocalPoint(point.localMetres, `/referencePoints/${String(index)}/localMetres`);
  });

  const manual = input.manualAdjustment;
  if (manual !== undefined) {
    const valid =
      Number.isFinite(manual.rotationRadians) &&
      Number.isFinite(manual.translationMetres.dx) &&
      Number.isFinite(manual.translationMetres.dy) &&
      Math.abs(manual.translationMetres.dx) <= MAXIMUM_COORDINATE_MAGNITUDE_METRES &&
      Math.abs(manual.translationMetres.dy) <= MAXIMUM_COORDINATE_MAGNITUDE_METRES;
    if (!valid) {
      throw new CalibrationInputError(
        'manual_adjustment_invalid',
        '/manualAdjustment',
        '/manualAdjustment must carry finite rotation and an in-range translation.',
      );
    }
  }
}

/**
 * Derives the transform and its honest error report from calibration
 * inputs. Deterministic: identical input yields byte-identical output in
 * every runtime.
 *
 * @throws {CalibrationInputError} for degenerate or out-of-range inputs.
 */
export function derivePlanCalibration(input: PlanCalibrationInput): PlanCalibrationDerivation {
  validateInput(input);

  const { pointA, pointB, distanceMetres } = input.knownDistance;
  const segmentLength = Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]);
  const scale = distanceMetres / segmentLength;

  // Control points, y-flipped and pre-scaled: the rigid fit below solves
  // local approximately equal to R(theta) * a + t.
  const flipped = input.referencePoints.map((point): Position => [
    scale * point.planPoint[0],
    -scale * point.planPoint[1],
  ]);
  const targets = input.referencePoints.map((point) => point.localMetres);

  let fittedRotation = 0;
  let fittedTranslation: Position = [0, 0];

  if (flipped.length === 1) {
    const a = flipped[0] as Position;
    const q = targets[0] as Position;
    fittedTranslation = [q[0] - a[0], q[1] - a[1]];
  } else if (flipped.length >= 2) {
    const n = flipped.length;
    const meanOf = (points: readonly Position[]): Position => [
      points.reduce((sum, p) => sum + p[0], 0) / n,
      points.reduce((sum, p) => sum + p[1], 0) / n,
    ];
    const aMean = meanOf(flipped);
    const qMean = meanOf(targets);

    // 2D Kabsch with fixed scale: theta = atan2(sum of cross, sum of dot)
    // over centered point pairs.
    let dotSum = 0;
    let crossSum = 0;
    for (let index = 0; index < n; index += 1) {
      const a = flipped[index] as Position;
      const q = targets[index] as Position;
      const ax = a[0] - aMean[0];
      const ay = a[1] - aMean[1];
      const qx = q[0] - qMean[0];
      const qy = q[1] - qMean[1];
      dotSum += ax * qx + ay * qy;
      crossSum += ax * qy - ay * qx;
    }
    fittedRotation = crossSum === 0 && dotSum === 0 ? 0 : Math.atan2(crossSum, dotSum);

    const cos = Math.cos(fittedRotation);
    const sin = Math.sin(fittedRotation);
    fittedTranslation = [
      qMean[0] - (aMean[0] * cos - aMean[1] * sin),
      qMean[1] - (aMean[0] * sin + aMean[1] * cos),
    ];
  }

  // Compose the manual adjustment (rotate about the local origin, then
  // translate) on top of the fit.
  const manual = input.manualAdjustment;
  let finalRotation = fittedRotation;
  let finalTranslation = fittedTranslation;
  if (manual !== undefined) {
    const cos = Math.cos(manual.rotationRadians);
    const sin = Math.sin(manual.rotationRadians);
    finalRotation = fittedRotation + manual.rotationRadians;
    finalTranslation = [
      fittedTranslation[0] * cos - fittedTranslation[1] * sin + manual.translationMetres.dx,
      fittedTranslation[0] * sin + fittedTranslation[1] * cos + manual.translationMetres.dy,
    ];
  }

  const transform: PlanTransform = {
    metresPerPlanUnit: roundTo(scale, SCALE_DECIMALS),
    rotationRadians: roundTo(normalizeRotation(finalRotation), ROTATION_DECIMALS),
    translationMetres: {
      x: roundCoordinate(finalTranslation[0]),
      y: roundCoordinate(finalTranslation[1]),
    },
  };

  // Residuals against the ROUNDED final transform - the exact placement
  // that will be stored and rendered, so the reported error describes what
  // the user actually sees.
  const pointResidualsMetres = input.referencePoints.map((point, index) => {
    const mapped = applyPlanTransform(transform, point.planPoint);
    const target = targets[index] as Position;
    return roundTo(Math.hypot(mapped[0] - target[0], mapped[1] - target[1]), RESIDUAL_DECIMALS);
  });

  const rmsErrorMetres =
    pointResidualsMetres.length < 2
      ? null
      : roundTo(
          Math.sqrt(
            pointResidualsMetres.reduce((sum, value) => sum + value * value, 0) /
              pointResidualsMetres.length,
          ),
          RESIDUAL_DECIMALS,
        );

  return { transform, pointResidualsMetres, rmsErrorMetres };
}
