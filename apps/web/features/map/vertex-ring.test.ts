import { describe, expect, it } from 'vitest';

import {
  canRemoveVertex,
  canRemoveVertexAt,
  editableRingOf,
  editableVertexIndices,
  edgesOf,
  isRingClosureVertex,
  midpointOf,
  movedRingClosureGeometry,
  referenceVertexFor,
} from './vertex-ring';

const SQUARE = {
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

const LINE = {
  type: 'LineString' as const,
  coordinates: [
    [0, 0],
    [1, 0],
    [2, 0],
  ] as const,
};

describe('editableRingOf', () => {
  it('addresses a LineString as an open ring 0', () => {
    expect(editableRingOf(LINE)).toEqual({
      ringIndex: 0,
      positions: LINE.coordinates,
      closed: false,
    });
  });

  it('addresses a Polygon exterior as a closed ring 0', () => {
    expect(editableRingOf(SQUARE)).toEqual({
      ringIndex: 0,
      positions: SQUARE.coordinates[0],
      closed: true,
    });
  });

  it('returns null for Point, MultiLineString, and MultiPolygon', () => {
    expect(editableRingOf({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(editableRingOf({ type: 'MultiLineString', coordinates: [LINE.coordinates] })).toBeNull();
    expect(editableRingOf({ type: 'MultiPolygon', coordinates: [SQUARE.coordinates] })).toBeNull();
  });
});

describe('midpointOf', () => {
  it('averages two positions', () => {
    expect(midpointOf([0, 0], [4, 2])).toEqual([2, 1]);
  });
});

describe('edgesOf', () => {
  it("yields one edge per consecutive pair, including a closed ring's closing edge", () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    const edges = edgesOf(ring);

    expect(edges).toHaveLength(4);
    expect(edges[0]).toEqual({ fromIndex: 0, insertAtIndex: 1, midpoint: [1, 0] });
    expect(edges[3]).toEqual({ fromIndex: 3, insertAtIndex: 4, midpoint: [0, 1] });
  });

  it('yields one fewer edge than positions for an open LineString', () => {
    const ring = editableRingOf(LINE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(edgesOf(ring)).toHaveLength(2);
  });
});

describe('editableVertexIndices', () => {
  it('excludes the trailing duplicate of a closed Polygon ring', () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(editableVertexIndices(ring)).toEqual([0, 1, 2, 3]);
  });

  it('includes every position of an open LineString', () => {
    const ring = editableRingOf(LINE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(editableVertexIndices(ring)).toEqual([0, 1, 2]);
  });
});

describe('canRemoveVertex', () => {
  it('refuses to shrink a Polygon below three unique vertices', () => {
    const triangle = {
      ringIndex: 0,
      closed: true,
      positions: [
        [0, 0],
        [2, 0],
        [1, 2],
        [0, 0],
      ] as const,
    };
    expect(canRemoveVertex(triangle)).toBe(false);
  });

  it('allows shrinking a Polygon with more than three unique vertices', () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(canRemoveVertex(ring)).toBe(true);
  });

  it('refuses to shrink a LineString below two points', () => {
    const twoPoints = {
      ringIndex: 0,
      closed: false,
      positions: [
        [0, 0],
        [1, 0],
      ] as const,
    };
    expect(canRemoveVertex(twoPoints)).toBe(false);
  });

  it('allows shrinking a LineString with more than two points', () => {
    const ring = editableRingOf(LINE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(canRemoveVertex(ring)).toBe(true);
  });
});

describe('isRingClosureVertex', () => {
  it('is true for a closed ring’s first vertex only', () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(isRingClosureVertex(ring, 0)).toBe(true);
    expect(isRingClosureVertex(ring, 1)).toBe(false);
    expect(isRingClosureVertex(ring, 3)).toBe(false);
  });

  it('is always false for an open LineString', () => {
    const ring = editableRingOf(LINE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(isRingClosureVertex(ring, 0)).toBe(false);
  });
});

describe('canRemoveVertexAt', () => {
  it('refuses the closure vertex even when the ring is otherwise large enough', () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(canRemoveVertexAt(ring, 0)).toBe(false);
    expect(canRemoveVertexAt(ring, 1)).toBe(true);
  });

  it('refuses every vertex once the ring is too small to shrink', () => {
    const triangle = {
      ringIndex: 0,
      closed: true,
      positions: [
        [0, 0],
        [2, 0],
        [1, 2],
        [0, 0],
      ] as const,
    };
    expect(canRemoveVertexAt(triangle, 1)).toBe(false);
  });
});

describe('referenceVertexFor', () => {
  it('uses the immediately preceding vertex for any index above zero', () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(referenceVertexFor(ring, 1)).toEqual([0, 0]);
    expect(referenceVertexFor(ring, 2)).toEqual([2, 0]);
  });

  it("wraps a closed ring's index 0 to the vertex before the closing duplicate", () => {
    const ring = editableRingOf(SQUARE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(referenceVertexFor(ring, 0)).toEqual([0, 2]);
  });

  it("falls back to the next vertex for an open LineString's index 0", () => {
    const ring = editableRingOf(LINE);
    if (ring === null) throw new Error('expected an editable ring');
    expect(referenceVertexFor(ring, 0)).toEqual([1, 0]);
  });
});

describe('movedRingClosureGeometry', () => {
  it('sets both the first and last stored position of a Polygon exterior ring', () => {
    const moved = movedRingClosureGeometry(SQUARE, [9, 9]);
    expect(moved).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [9, 9],
          [2, 0],
          [2, 2],
          [0, 2],
          [9, 9],
        ],
      ],
    });
  });

  it('returns non-Polygon geometry unchanged', () => {
    expect(movedRingClosureGeometry(LINE, [9, 9])).toBe(LINE);
  });
});
