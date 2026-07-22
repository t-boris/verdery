import { describe, expect, it } from 'vitest';
import { loadFixture } from '@verdery/test-fixtures';
import type { CurveFixture } from '@verdery/test-fixtures';

import { densifyCubicChain, isValidControlPointCount, segmentCount } from './curve.js';
import type { Position } from './geometry.js';
import { MAXIMUM_CHORD_DEVIATION_METRES } from './tolerances.js';

const fixture = loadFixture<CurveFixture>('geometry/curves.json');

/** Point on a cubic Bézier at parameter t, used only to verify the contract independently. */
function pointOnCubic(p0: Position, p1: Position, p2: Position, p3: Position, t: number): Position {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;

  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function distanceToSegment(point: Position, from: Position, to: Position): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point[0] - from[0], point[1] - from[1]);
  }

  const raw = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, raw));

  return Math.hypot(point[0] - (from[0] + clamped * dx), point[1] - (from[1] + clamped * dy));
}

/** Greatest distance from the true curve to the produced polyline. */
function measureDeviation(
  controlPoints: readonly Position[],
  polyline: readonly Position[],
): number {
  let worst = 0;

  for (let segment = 0; segment < segmentCount(controlPoints); segment += 1) {
    const base = segment * 3;
    const p0 = controlPoints[base] as Position;
    const p1 = controlPoints[base + 1] as Position;
    const p2 = controlPoints[base + 2] as Position;
    const p3 = controlPoints[base + 3] as Position;

    for (let step = 0; step <= 500; step += 1) {
      const sample = pointOnCubic(p0, p1, p2, p3, step / 500);

      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < polyline.length - 1; index += 1) {
        nearest = Math.min(
          nearest,
          distanceToSegment(sample, polyline[index] as Position, polyline[index + 1] as Position),
        );
      }

      worst = Math.max(worst, nearest);
    }
  }

  return worst;
}

describe('curve densification fixture', () => {
  it('uses the expected schema version', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.comparison).toBe('exact');
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'densifies %s',
    (_name, testCase) => {
      const polyline = densifyCubicChain(testCase.controlPoints, testCase.toleranceMetres);
      expect(polyline).toEqual(testCase.expectedPolyline);
    },
  );
});

describe('densifyCubicChain', () => {
  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'stays within tolerance for %s',
    (_name, testCase) => {
      const polyline = densifyCubicChain(testCase.controlPoints, testCase.toleranceMetres);
      const deviation = measureDeviation(testCase.controlPoints, polyline);

      // The rounding step can move a vertex by at most half the grid diagonal.
      const roundingAllowance = Math.hypot(0.0005, 0.0005);
      expect(deviation).toBeLessThanOrEqual(testCase.toleranceMetres + roundingAllowance);
    },
  );

  it('preserves the first and last control points', () => {
    for (const testCase of fixture.cases) {
      const polyline = densifyCubicChain(testCase.controlPoints, testCase.toleranceMetres);
      const controlPoints = testCase.controlPoints;

      expect(polyline[0]).toEqual(controlPoints[0]);
      expect(polyline[polyline.length - 1]).toEqual(controlPoints[controlPoints.length - 1]);
    }
  });

  it('produces more vertices at a tighter tolerance', () => {
    const controlPoints: Position[] = [
      [0, 0],
      [0, 0.5523],
      [0.4477, 1],
      [1, 1],
    ];

    const coarse = densifyCubicChain(controlPoints, MAXIMUM_CHORD_DEVIATION_METRES);
    const fine = densifyCubicChain(controlPoints, MAXIMUM_CHORD_DEVIATION_METRES / 5);

    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it('never emits a repeated vertex', () => {
    for (const testCase of fixture.cases) {
      const polyline = densifyCubicChain(testCase.controlPoints, testCase.toleranceMetres);

      for (let index = 1; index < polyline.length; index += 1) {
        expect(polyline[index]).not.toEqual(polyline[index - 1]);
      }
    }
  });

  it('rejects a control-point count that is not 3n + 1', () => {
    expect(() =>
      densifyCubicChain([
        [0, 0],
        [1, 1],
        [2, 0],
      ]),
    ).toThrow(RangeError);
  });

  it('rejects a non-positive tolerance', () => {
    const controlPoints: Position[] = [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ];

    expect(() => densifyCubicChain(controlPoints, 0)).toThrow(RangeError);
    expect(() => densifyCubicChain(controlPoints, -1)).toThrow(RangeError);
  });
});

describe('isValidControlPointCount', () => {
  it('accepts cubic chains', () => {
    expect(isValidControlPointCount(4)).toBe(true);
    expect(isValidControlPointCount(7)).toBe(true);
    expect(isValidControlPointCount(10)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const count of [0, 1, 2, 3, 5, 6, 8, 9]) {
      expect(isValidControlPointCount(count)).toBe(false);
    }
  });
});
