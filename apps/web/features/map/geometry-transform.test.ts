import { describe, expect, it } from 'vitest';

import {
  angleBetween,
  boundingBoxCentroid,
  cornerScaleFactor,
  rotateGeometry,
  rotatePosition,
  scaleGeometry,
  scalePosition,
} from './geometry-transform';

describe('boundingBoxCentroid', () => {
  it('returns the bounding-box center of a set of positions', () => {
    expect(
      boundingBoxCentroid([
        [0, 0],
        [4, 2],
      ]),
    ).toEqual([2, 1]);
  });

  it('returns null for an empty set', () => {
    expect(boundingBoxCentroid([])).toBeNull();
  });
});

describe('scalePosition', () => {
  it('scales a position away from the centroid by independent x/y factors', () => {
    expect(scalePosition([4, 6], [2, 2], 2, 0.5)).toEqual([6, 4]);
  });

  it('leaves the centroid itself fixed under any scale', () => {
    expect(scalePosition([2, 2], [2, 2], 3, 5)).toEqual([2, 2]);
  });
});

describe('rotatePosition', () => {
  it('rotates a position 90 degrees counterclockwise around the centroid', () => {
    const [x, y] = rotatePosition([1, 0], [0, 0], Math.PI / 2);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10);
  });

  it('leaves the centroid itself fixed under any rotation', () => {
    expect(rotatePosition([3, 3], [3, 3], Math.PI / 4)).toEqual([3, 3]);
  });

  it('returns the original position for a full turn', () => {
    const [x, y] = rotatePosition([5, 2], [1, 1], Math.PI * 2);
    expect(x).toBeCloseTo(5, 9);
    expect(y).toBeCloseTo(2, 9);
  });
});

describe('scaleGeometry', () => {
  it('scales every coordinate of a Polygon around the centroid', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ] as const,
      ],
    };
    const scaled = scaleGeometry(geometry, [1, 1], 2, 2);
    expect(scaled).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-1, -1],
          [3, -1],
          [3, 3],
          [-1, 3],
          [-1, -1],
        ],
      ],
    });
  });

  it('scales a Point in place', () => {
    const geometry = { type: 'Point' as const, coordinates: [4, 4] as const };
    expect(scaleGeometry(geometry, [2, 2], 0.5, 0.5)).toEqual({
      type: 'Point',
      coordinates: [3, 3],
    });
  });
});

describe('rotateGeometry', () => {
  it('rotates every coordinate of a LineString around the centroid', () => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [
        [1, 0],
        [2, 0],
      ] as const,
    };
    const rotated = rotateGeometry(geometry, [0, 0], Math.PI / 2) as {
      readonly coordinates: readonly (readonly [number, number])[];
    };
    expect(rotated.coordinates[0]?.[0]).toBeCloseTo(0, 10);
    expect(rotated.coordinates[0]?.[1]).toBeCloseTo(1, 10);
    expect(rotated.coordinates[1]?.[0]).toBeCloseTo(0, 10);
    expect(rotated.coordinates[1]?.[1]).toBeCloseTo(2, 10);
  });
});

describe('cornerScaleFactor', () => {
  it('computes a scale factor of 2 when the dragged corner is twice as far from the anchor', () => {
    expect(cornerScaleFactor(0, 5, 10)).toBe(2);
  });

  it('computes a scale factor of 1 when the corner has not moved', () => {
    expect(cornerScaleFactor(0, 5, 5)).toBe(1);
  });

  it('computes a negative factor when the corner crosses past the anchor', () => {
    expect(cornerScaleFactor(0, 5, -5)).toBe(-1);
  });

  it('clamps a near-zero factor away from zero to avoid a collapsed or inverted shape', () => {
    expect(cornerScaleFactor(0, 10, 0.01)).toBeCloseTo(0.05, 10);
  });

  it('returns 1 when the original offset from the anchor was already zero', () => {
    expect(cornerScaleFactor(5, 5, 20)).toBe(1);
  });
});

describe('angleBetween', () => {
  it('measures a positive quarter turn counterclockwise', () => {
    const angle = angleBetween([0, 0], [1, 0], [0, 1]);
    expect(angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('measures a negative quarter turn clockwise', () => {
    const angle = angleBetween([0, 0], [0, 1], [1, 0]);
    expect(angle).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('is zero when both vectors point the same direction', () => {
    expect(angleBetween([0, 0], [2, 0], [5, 0])).toBeCloseTo(0, 10);
  });
});
