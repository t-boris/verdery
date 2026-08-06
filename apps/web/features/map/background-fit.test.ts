import { describe, expect, it } from 'vitest';
import type { Geometry } from '@verdery/geometry-contracts';

import { containFitRect, geometryScreenRect } from './background-fit';
import type { CanvasSize, MapCamera } from './types';

const CAMERA: MapCamera = { centerX: 0, centerY: 0, scale: 10, rotationDegrees: 0 };
const SIZE: CanvasSize = { width: 800, height: 600 };

const SQUARE: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ],
  ],
};

describe('geometryScreenRect', () => {
  it('converts the polygon bounding box into a screen rectangle, flipping the Y axis once', () => {
    const rect = geometryScreenRect(SQUARE, CAMERA, SIZE);
    // Local (0, 20) — the box's top-left — lands at screen (400, 300 - 200).
    expect(rect).toEqual({ x: 400, y: 100, width: 200, height: 200 });
  });
});

describe('containFitRect', () => {
  const bounds = { x: 100, y: 50, width: 200, height: 100 };

  it('letterboxes a wider-than-bounds image vertically, centered', () => {
    // Aspect 4:1 inside 2:1 bounds: full width, half height, centered.
    expect(containFitRect(bounds, 4)).toEqual({ x: 100, y: 75, width: 200, height: 50 });
  });

  it('pillarboxes a taller-than-bounds image horizontally, centered', () => {
    // Aspect 1:1 inside 2:1 bounds: full height, square width, centered.
    expect(containFitRect(bounds, 1)).toEqual({ x: 150, y: 50, width: 100, height: 100 });
  });

  it('fills the bounds exactly when aspects match', () => {
    expect(containFitRect(bounds, 2)).toEqual(bounds);
  });

  it('returns the bounds unchanged for a degenerate aspect', () => {
    expect(containFitRect(bounds, 0)).toEqual(bounds);
    expect(containFitRect(bounds, Number.NaN)).toEqual(bounds);
  });
});
