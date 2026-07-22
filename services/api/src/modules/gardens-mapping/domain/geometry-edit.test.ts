import { describe, expect, it } from 'vitest';
import type { Geometry } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  applyVertexOperation,
  joinLineStrings,
  splitLineString,
  translateGeometry,
} from './geometry-edit.js';

function asType<Type extends Geometry['type']>(
  geometry: Geometry,
  type: Type,
): Extract<Geometry, { type: Type }> {
  if (geometry.type !== type) {
    throw new Error(`Expected geometry type ${type}, got ${geometry.type}.`);
  }
  return geometry as Extract<Geometry, { type: Type }>;
}

const POINT: Geometry = { type: 'Point', coordinates: [1, 2] };
const LINE: Geometry = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
};
const POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ],
  ],
};
const MULTI_LINE: Geometry = {
  type: 'MultiLineString',
  coordinates: [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [5, 5],
      [6, 5],
    ],
  ],
};
const MULTI_POLYGON: Geometry = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  ],
};

describe('translateGeometry', () => {
  it('translates a Point', () => {
    expect(translateGeometry(POINT, 1, 1)).toEqual({ type: 'Point', coordinates: [2, 3] });
  });

  it('translates every position of a LineString', () => {
    const result = translateGeometry(LINE, 10, 0);
    expect(result).toEqual({
      type: 'LineString',
      coordinates: [
        [10, 0],
        [11, 0],
        [12, 0],
        [13, 0],
      ],
    });
  });

  it('translates every ring of a Polygon', () => {
    const result = asType(translateGeometry(POLYGON, -1, -1), 'Polygon');
    expect(result.coordinates[0]?.[0]).toEqual([-1, -1]);
  });
});

describe('applyVertexOperation', () => {
  it('moves the sole vertex of a Point', () => {
    const result = applyVertexOperation(POINT, 0, 0, 'move', [9, 9]);
    expect(result).toEqual({ type: 'Point', coordinates: [9, 9] });
  });

  it('rejects insert on a Point', () => {
    expect(() => applyVertexOperation(POINT, 0, 0, 'insert', [9, 9])).toThrow(ValidationError);
  });

  it('rejects a ring index other than 0 on a Point', () => {
    expect(() => applyVertexOperation(POINT, 1, 0, 'move', [9, 9])).toThrow(ValidationError);
  });

  it('moves a vertex of a LineString', () => {
    const result = asType(applyVertexOperation(LINE, 0, 1, 'move', [99, 99]), 'LineString');
    expect(result.coordinates[1]).toEqual([99, 99]);
    expect(result.coordinates).toHaveLength(4);
  });

  it('inserts a vertex into a LineString at the given index', () => {
    const result = asType(applyVertexOperation(LINE, 0, 1, 'insert', [0.5, 5]), 'LineString');
    expect(result.coordinates).toHaveLength(5);
    expect(result.coordinates[1]).toEqual([0.5, 5]);
  });

  it('appends when inserting at the array length', () => {
    const result = asType(applyVertexOperation(LINE, 0, 4, 'insert', [99, 99]), 'LineString');
    expect(result.coordinates).toHaveLength(5);
    expect(result.coordinates[4]).toEqual([99, 99]);
  });

  it('removes a vertex from a LineString', () => {
    const result = asType(applyVertexOperation(LINE, 0, 1, 'remove', undefined), 'LineString');
    expect(result.coordinates).toHaveLength(3);
    expect(result.coordinates).toEqual([
      [0, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it('rejects move/insert without a position', () => {
    expect(() => applyVertexOperation(LINE, 0, 1, 'move', undefined)).toThrow(ValidationError);
    expect(() => applyVertexOperation(LINE, 0, 1, 'insert', undefined)).toThrow(ValidationError);
  });

  it('rejects an out-of-range vertexIndex', () => {
    expect(() => applyVertexOperation(LINE, 0, 99, 'move', [1, 1])).toThrow(ValidationError);
    expect(() => applyVertexOperation(LINE, 0, -1, 'remove', undefined)).toThrow(ValidationError);
  });

  it('edits the addressed ring of a Polygon', () => {
    const result = asType(applyVertexOperation(POLYGON, 0, 2, 'move', [40, 30]), 'Polygon');
    expect(result.coordinates[0]?.[2]).toEqual([40, 30]);
  });

  it('rejects an out-of-range ring index on a Polygon', () => {
    expect(() => applyVertexOperation(POLYGON, 5, 0, 'move', [1, 1])).toThrow(ValidationError);
  });

  it('edits the addressed line of a MultiLineString', () => {
    const result = asType(
      applyVertexOperation(MULTI_LINE, 1, 0, 'move', [50, 50]),
      'MultiLineString',
    );
    expect(result.coordinates[1]?.[0]).toEqual([50, 50]);
    // The untouched line is unchanged.
    expect(result.coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it('rejects vertex editing on a MultiPolygon', () => {
    expect(() => applyVertexOperation(MULTI_POLYGON, 0, 0, 'move', [1, 1])).toThrow(
      ValidationError,
    );
  });
});

describe('splitLineString', () => {
  it('splits at an interior vertex, sharing the split vertex between both pieces', () => {
    const [first, second] = splitLineString(LINE, 1);
    expect(first).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    });
    expect(second).toEqual({
      type: 'LineString',
      coordinates: [
        [1, 0],
        [2, 0],
        [3, 0],
      ],
    });
  });

  it('rejects splitting at the first or last vertex', () => {
    expect(() => splitLineString(LINE, 0)).toThrow(ValidationError);
    expect(() => splitLineString(LINE, 3)).toThrow(ValidationError);
  });

  it('rejects splitting a non-LineString geometry', () => {
    expect(() => splitLineString(POLYGON, 1)).toThrow(ValidationError);
  });
});

describe('joinLineStrings', () => {
  it('drops the duplicate vertex when the lines already share an endpoint', () => {
    const first: Geometry = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    };
    const second: Geometry = {
      type: 'LineString',
      coordinates: [
        [1, 0],
        [2, 0],
      ],
    };
    expect(joinLineStrings(first, second)).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    });
  });

  it('concatenates without deduplication when the endpoints do not coincide', () => {
    const first: Geometry = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    };
    const second: Geometry = {
      type: 'LineString',
      coordinates: [
        [5, 5],
        [6, 5],
      ],
    };
    expect(joinLineStrings(first, second)).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
        [5, 5],
        [6, 5],
      ],
    });
  });

  it('rejects joining a non-LineString geometry', () => {
    expect(() => joinLineStrings(POINT, LINE)).toThrow(ValidationError);
  });
});
