import type { Position } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import type { MapObjectRecord } from './types';
import {
  ANGLE_SNAP_INCREMENT_DEGREES,
  ROUND_DISTANCE_INCREMENT_METRES,
  snapPosition,
  snapToAngleIncrement,
  snapToAxisAlignment,
  snapToEdge,
  snapToRoundDistance,
  snapToVertex,
} from './snapping';

function objectRecord(
  id: string,
  geometry: MapObjectRecord['geometry'],
  category: MapObjectRecord['category'] = 'structure',
): MapObjectRecord {
  return {
    id,
    gardenId: 'garden',
    category,
    geometry,
    lifecycleState: 'active',
    revision: 1,
    createdAt: '2026-07-21T00:00:00Z',
    updatedAt: '2026-07-21T00:00:00Z',
  };
}

const SQUARE = objectRecord('square', {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ],
  ],
});

const LOT = objectRecord(
  'lot',
  {
    type: 'Polygon',
    coordinates: [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
        [-10, -10],
      ],
    ],
  },
  'lot',
);

describe('snapToVertex', () => {
  it('snaps a candidate near an existing vertex exactly onto it', () => {
    const result = snapToVertex([4.05, 0.02], [SQUARE], 0.2);
    expect(result).toEqual({ kind: 'vertex', position: [4, 0], targetObjectId: 'square' });
  });

  it('returns null when nothing is within tolerance', () => {
    expect(snapToVertex([2, 2], [SQUARE], 0.2)).toBeNull();
  });

  it('excludes the specified vertex from candidates', () => {
    // [4, 0] is vertex index 1 of the square's ring 0 — excluding it should
    // fall through to nothing within tolerance at this point.
    const result = snapToVertex([4.05, 0.02], [SQUARE], 0.2, {
      objectId: 'square',
      ringIndex: 0,
      vertexIndex: 1,
    });
    expect(result).toBeNull();
  });

  it("treats a lot's own vertices as ordinary snap targets, with no special-casing", () => {
    const result = snapToVertex([10.03, 10.02], [LOT], 0.2);
    expect(result).toEqual({ kind: 'vertex', position: [10, 10], targetObjectId: 'lot' });
  });

  it('prefers the nearer of two candidate vertices', () => {
    const other = objectRecord('near', { type: 'Point', coordinates: [4.01, 0.01] });
    const result = snapToVertex([4.05, 0.02], [SQUARE, other], 0.5);
    expect(result?.targetObjectId).toBe('near');
  });
});

describe('snapToEdge', () => {
  it('projects a candidate near an edge, but not near a vertex, onto the edge', () => {
    // Midpoint of the square's bottom edge (0,0)-(4,0) is (2,0).
    const result = snapToEdge([2, 0.05], [SQUARE], 0.2);
    expect(result).toEqual({ kind: 'edge', position: [2, 0], targetObjectId: 'square' });
  });

  it('clamps the projection to the segment rather than extending past it', () => {
    // Diagonally outside the square's (0,0) corner: the nearest point on
    // either adjacent edge — (0,0)-(4,0) and (0,4)-(0,0) — clamps to the
    // shared corner itself rather than extending the line past it.
    const result = snapToEdge([-0.1, -0.02], [SQUARE], 0.2);
    expect(result?.position).toEqual([0, 0]);
  });

  it('returns null when nothing is within tolerance', () => {
    expect(snapToEdge([2, 2], [SQUARE], 0.2)).toBeNull();
  });
});

describe('snapToAxisAlignment', () => {
  it('locks y to the reference when the candidate is nearly horizontal from it', () => {
    const result = snapToAxisAlignment([5, 0.05], [0, 0]);
    expect(result).toEqual({ kind: 'horizontal', position: [5, 0] });
  });

  it('locks x to the reference when the candidate is nearly vertical from it', () => {
    const result = snapToAxisAlignment([0.05, 5], [0, 0]);
    expect(result).toEqual({ kind: 'vertical', position: [0, 5] });
  });

  it('returns null when the direction is not close to horizontal or vertical', () => {
    expect(snapToAxisAlignment([5, 4], [0, 0])).toBeNull();
  });

  it('returns null when the candidate has not moved from the reference', () => {
    expect(snapToAxisAlignment([0, 0], [0, 0])).toBeNull();
  });
});

describe('snapToAngleIncrement', () => {
  it('snaps an exact 45-degree candidate onto itself, preserving distance', () => {
    const distance = Math.SQRT2 * 3;
    const result = snapToAngleIncrement([3, 3], [0, 0]);
    expect(result?.kind).toBe('angle');
    expect(result?.position[0]).toBeCloseTo(3, 9);
    expect(result?.position[1]).toBeCloseTo(3, 9);
    expect(Math.hypot(result?.position[0] ?? 0, result?.position[1] ?? 0)).toBeCloseTo(distance, 9);
  });

  it('snaps a near-45-degree candidate onto the exact increment', () => {
    // atan2(5, 4.7) is a couple of degrees short of 45.
    const result = snapToAngleIncrement([4.7, 5], [0, 0]);
    expect(result).not.toBeNull();
    const angle = (Math.atan2(result?.position[1] ?? 0, result?.position[0] ?? 0) * 180) / Math.PI;
    expect(angle).toBeCloseTo(ANGLE_SNAP_INCREMENT_DEGREES, 9);
  });

  it('returns null when the angle is too far from any increment', () => {
    expect(snapToAngleIncrement([5, 1], [0, 0])).toBeNull();
  });

  it('returns null when the candidate has not moved from the reference', () => {
    expect(snapToAngleIncrement([0, 0], [0, 0])).toBeNull();
  });
});

describe('snapToRoundDistance', () => {
  it('snaps a distance close to a round number of metres onto it, preserving angle', () => {
    // Distance from (0,0) to (3.02, 0) is 3.02m, close to the round 3.0m.
    const result = snapToRoundDistance([3.02, 0], [0, 0]);
    expect(result?.kind).toBe('distance');
    expect(result?.position[0]).toBeCloseTo(3, 9);
    expect(result?.position[1]).toBeCloseTo(0, 9);
  });

  it('snaps onto the nearest half-metre increment', () => {
    const result = snapToRoundDistance([0, 2.48], [0, 0]);
    expect(result?.position[1]).toBeCloseTo(2.5, 9);
  });

  it('returns null when the distance is not close to a round increment', () => {
    expect(snapToRoundDistance([0, 2.2], [0, 0])).toBeNull();
  });

  it('never snaps onto zero distance', () => {
    expect(snapToRoundDistance([0.05, 0], [0, 0])).toBeNull();
  });
});

describe('snapPosition', () => {
  const TOLERANCE = 0.2;

  it('passes a candidate through unchanged when nothing is nearby', () => {
    const result = snapPosition([50, 50], {
      objects: [SQUARE],
      toleranceMetres: TOLERANCE,
    });
    expect(result).toEqual({ position: [50, 50], snap: null });
  });

  it('prefers a vertex snap over everything else, including an aligned reference', () => {
    // (4.02, 0.02) is near vertex (4,0) AND nearly horizontal from (0,0) —
    // the vertex snap must win.
    const result = snapPosition([4.02, 0.02], {
      objects: [SQUARE],
      referencePoint: [0, 0],
      toleranceMetres: TOLERANCE,
    });
    expect(result.snap?.kind).toBe('vertex');
    expect(result.position).toEqual([4, 0]);
  });

  it('falls back to an edge snap when no vertex is close enough', () => {
    const result = snapPosition([2, 0.05], {
      objects: [SQUARE],
      referencePoint: [0, 5],
      toleranceMetres: TOLERANCE,
    });
    expect(result.snap?.kind).toBe('edge');
    expect(result.position).toEqual([2, 0]);
  });

  it('falls back to horizontal/vertical alignment when no vertex or edge is close', () => {
    const result = snapPosition([8, 0.03], {
      objects: [SQUARE],
      referencePoint: [0, 0],
      toleranceMetres: TOLERANCE,
    });
    expect(result.snap?.kind).toBe('horizontal');
    expect(result.position).toEqual([8, 0]);
  });

  it('falls back to the angle increment when axis alignment does not apply', () => {
    const result = snapPosition([4.7, 5], {
      objects: [SQUARE],
      referencePoint: [20, 20],
      toleranceMetres: TOLERANCE,
    });
    expect(result.snap?.kind).toBe('angle');
  });

  it('falls back to round distance when nothing sharper applies', () => {
    // 20 degrees from the reference is far from both an axis and a
    // 45-degree increment, at a distance (3.02m) close to a round 3m —
    // isolating the round-distance snap from the other two reference-relative
    // checks, which is what "nothing sharper applies" means here.
    const reference: Position = [0, 0];
    const angleRadians = (20 * Math.PI) / 180;
    const distance = 3.02;
    const candidate: Position = [
      reference[0] + distance * Math.cos(angleRadians),
      reference[1] + distance * Math.sin(angleRadians),
    ];

    const result = snapPosition(candidate, {
      objects: [SQUARE],
      referencePoint: reference,
      toleranceMetres: TOLERANCE,
    });
    expect(result.snap?.kind).toBe('distance');
    expect(Math.hypot(result.position[0], result.position[1])).toBeCloseTo(3, 9);
  });

  it('is disabled entirely when the context says so, even near a vertex', () => {
    const result = snapPosition([4.02, 0.02], {
      objects: [SQUARE],
      toleranceMetres: TOLERANCE,
      disabled: true,
    });
    expect(result).toEqual({ position: [4.02, 0.02], snap: null });
  });

  it('excludes the vertex currently being dragged from being reported as a vertex snap', () => {
    // Without exclusion, (4.02, 0.02) reports a 'vertex' snap onto (4, 0).
    const withoutExclusion = snapPosition([4.02, 0.02], {
      objects: [SQUARE],
      toleranceMetres: TOLERANCE,
    });
    expect(withoutExclusion.snap).toEqual({
      kind: 'vertex',
      position: [4, 0],
      targetObjectId: 'square',
    });

    // Excluding that same vertex removes it from vertex candidates, so
    // `snapToVertex` no longer reports it — but the two edges meeting at
    // that corner still carry it as their (un-moved) endpoint, so the
    // candidate falls through to a nearby 'edge' snap instead of passing
    // through unchanged.
    const withExclusion = snapPosition([4.02, 0.02], {
      objects: [SQUARE],
      excludeVertex: { objectId: 'square', ringIndex: 0, vertexIndex: 1 },
      toleranceMetres: TOLERANCE,
    });
    expect(withExclusion.snap?.kind).toBe('edge');
  });

  it('respects the documented increment constant for round-distance snapping', () => {
    expect(ROUND_DISTANCE_INCREMENT_METRES).toBe(0.5);
  });
});
