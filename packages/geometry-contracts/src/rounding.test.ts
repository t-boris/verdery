import { describe, expect, it } from 'vitest';
import { loadFixture, resolveNumber } from '@verdery/test-fixtures';
import type { RoundingFixture } from '@verdery/test-fixtures';

import {
  CoordinateRangeError,
  coordinatesEqual,
  roundCoordinate,
  roundPosition,
} from './rounding.js';

const fixture = loadFixture<RoundingFixture>('geometry/rounding.json');

describe('coordinate rounding fixture', () => {
  it('uses the expected schema version', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.comparison).toBe('exact');
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'rounds %s',
    (_name, testCase) => {
      expect(roundCoordinate(testCase.input)).toBe(testCase.expected);
    },
  );

  it.each(fixture.rejectedCases.map((testCase) => [testCase.name, testCase] as const))(
    'rejects %s',
    (_name, testCase) => {
      expect(() => roundCoordinate(resolveNumber(testCase.input))).toThrow(CoordinateRangeError);
    },
  );
});

describe('roundCoordinate', () => {
  it('is idempotent', () => {
    for (const value of [1.23456, -9.87654, 0.0005, -0.0015, 4999.9999]) {
      const once = roundCoordinate(value);
      expect(roundCoordinate(once)).toBe(once);
    }
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundCoordinate(-0.0001), -0)).toBe(false);
    expect(roundCoordinate(-0.0001)).toBe(0);
  });
});

describe('roundPosition', () => {
  it('rounds both axes', () => {
    expect(roundPosition([1.23449, -7.6544])).toEqual([1.234, -7.654]);
  });
});

describe('coordinatesEqual', () => {
  it('treats values within the storage grid as equal', () => {
    expect(coordinatesEqual(1.2344, 1.23441)).toBe(true);
  });

  it('separates values on different grid points', () => {
    expect(coordinatesEqual(1.2344, 1.2351)).toBe(false);
  });
});
