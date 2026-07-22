/**
 * Coordinate rounding.
 *
 * Coordinates are rounded to a 1 mm grid before persistence so that the
 * backend, the Apple client, and the web client produce byte-identical output
 * for the same input. Fixtures compare exactly rather than with an epsilon, so
 * this function must behave identically in every runtime.
 *
 * The rule is: scale by 10^3, round half away from zero, scale back. Every
 * runtime performs the arithmetic in IEEE 754 double precision, so the
 * intermediate representation is the same everywhere.
 *
 * Source: ADR-0010, "Coordinate precision".
 */

import { COORDINATE_DECIMAL_PLACES, MAXIMUM_COORDINATE_MAGNITUDE_METRES } from './tolerances.js';

const SCALE = 10 ** COORDINATE_DECIMAL_PLACES;

/** Raised when a coordinate cannot be represented in the local space. */
export class CoordinateRangeError extends Error {
  public readonly value: number;

  constructor(value: number) {
    super(
      `Coordinate ${String(value)} is outside the supported local range of ` +
        `±${String(MAXIMUM_COORDINATE_MAGNITUDE_METRES)} m.`,
    );
    this.name = 'CoordinateRangeError';
    this.value = value;
  }
}

/**
 * Rounds one coordinate value in metres to the storage grid.
 *
 * Rounds half away from zero, so 0.0005 becomes 0.001 and -0.0005 becomes
 * -0.001. Negative zero is normalized to zero so that serialized fixtures never
 * differ by a sign bit alone.
 *
 * @throws {CoordinateRangeError} when the value is not finite or is out of range.
 */
export function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new CoordinateRangeError(value);
  }

  if (Math.abs(value) > MAXIMUM_COORDINATE_MAGNITUDE_METRES) {
    throw new CoordinateRangeError(value);
  }

  const scaled = value * SCALE;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  const result = rounded / SCALE;

  return result === 0 ? 0 : result;
}

/** Rounds a coordinate pair. */
export function roundPosition(position: readonly [number, number]): [number, number] {
  return [roundCoordinate(position[0]), roundCoordinate(position[1])];
}

/**
 * True when two coordinate values refer to the same point on the storage grid.
 *
 * Compares rounded values rather than raw values, so callers do not need to
 * agree on an epsilon.
 */
export function coordinatesEqual(left: number, right: number): boolean {
  return roundCoordinate(left) === roundCoordinate(right);
}
