import { describe, expect, it } from 'vitest';
import type { Geometry } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';

const VALID_BED_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

describe('requireValidGeometryForCategory', () => {
  it('accepts a geometry type the category allows', () => {
    expect(() => requireValidGeometryForCategory('bed', VALID_BED_POLYGON)).not.toThrow();
  });

  it('rejects a geometry type the category does not allow', () => {
    const point: Geometry = { type: 'Point', coordinates: [0, 0] };
    expect(() => requireValidGeometryForCategory('bed', point)).toThrow(ValidationError);
  });

  it('rejects a degenerate polygon (too small an area) even when the type matches', () => {
    const tiny: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0.001, 0],
          [0.001, 0.001],
          [0, 0.001],
          [0, 0],
        ],
      ],
    };
    expect(() => requireValidGeometryForCategory('bed', tiny)).toThrow(ValidationError);
  });

  it('rejects a LineString below the minimum vertex count', () => {
    const degenerate: Geometry = { type: 'LineString', coordinates: [[0, 0]] };
    expect(() => requireValidGeometryForCategory('fence', degenerate)).toThrow(ValidationError);
  });

  it('rejects a non-finite coordinate', () => {
    const invalid: Geometry = { type: 'Point', coordinates: [Number.NaN, 0] };
    expect(() => requireValidGeometryForCategory('tree', invalid)).toThrow(ValidationError);
  });
});
