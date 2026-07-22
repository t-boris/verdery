import { describe, expect, it } from 'vitest';
import { loadFixture } from '@verdery/test-fixtures';
import type { ValidationFixture } from '@verdery/test-fixtures';

import type { Geometry, Position } from './geometry.js';
import {
  isGeometryValid,
  lineLength,
  ringArea,
  ringSelfIntersects,
  validateGeometry,
} from './validation.js';

const fixture = loadFixture<ValidationFixture>('geometry/validation.json');

describe('geometry validation fixture', () => {
  it('uses the expected schema version', () => {
    expect(fixture.schemaVersion).toBe(1);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'validates %s',
    (_name, testCase) => {
      const issues = validateGeometry(testCase.geometry as Geometry);
      expect(issues.map((issue) => issue.code)).toEqual(testCase.expectedCodes);
    },
  );

  it('marks every fixture case with no expected codes as valid', () => {
    for (const testCase of fixture.cases) {
      if (testCase.expectedCodes.length === 0) {
        expect(isGeometryValid(testCase.geometry as Geometry)).toBe(true);
      }
    }
  });
});

describe('ringArea', () => {
  it('measures a unit square regardless of winding', () => {
    const clockwise: Position[] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ];
    const counterClockwise: Position[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];

    expect(ringArea(clockwise)).toBe(1);
    expect(ringArea(counterClockwise)).toBe(1);
  });
});

describe('lineLength', () => {
  it('sums segment lengths', () => {
    expect(
      lineLength([
        [0, 0],
        [3, 4],
        [3, 9],
      ]),
    ).toBe(10);
  });
});

describe('ringSelfIntersects', () => {
  it('accepts a simple ring', () => {
    expect(
      ringSelfIntersects([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ]),
    ).toBe(false);
  });

  it('detects a crossing ring', () => {
    expect(
      ringSelfIntersects([
        [0, 0],
        [4, 0],
        [1, 3],
        [3, 3],
        [0, 0],
      ]),
    ).toBe(true);
  });
});
