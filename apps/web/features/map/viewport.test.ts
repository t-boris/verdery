import { describe, expect, it } from 'vitest';

import type { MapObjectRecord } from './types';
import {
  boundingBoxOfObjects,
  boundingBoxOfPositions,
  cameraFittingBounds,
  isRecordInViewport,
  panCamera,
  screenDeltaToLocalDelta,
  toLocal,
  toScreen,
  zoomCamera,
} from './viewport';

const SIZE = { width: 800, height: 600 };
const CAMERA = { centerX: 0, centerY: 0, scale: 20 };

describe('toScreen / toLocal', () => {
  it('are inverse for a point at the camera center', () => {
    const screen = toScreen([0, 0], CAMERA, SIZE);
    expect(screen).toEqual({ x: 400, y: 300 });
    expect(toLocal(screen, CAMERA, SIZE)).toEqual([0, 0]);
  });

  it('flips the Y axis: increasing local Y moves up the screen (smaller screen Y)', () => {
    const higher = toScreen([0, 5], CAMERA, SIZE);
    const lower = toScreen([0, -5], CAMERA, SIZE);
    expect(higher.y).toBeLessThan(lower.y);
  });

  it('round-trips an arbitrary screen point', () => {
    const local = toLocal({ x: 120, y: 450 }, CAMERA, SIZE);
    expect(toScreen(local, CAMERA, SIZE)).toEqual({ x: 120, y: 450 });
  });
});

describe('screenDeltaToLocalDelta', () => {
  it('divides by scale and flips Y', () => {
    expect(screenDeltaToLocalDelta(40, 20, CAMERA)).toEqual({ dx: 2, dy: -1 });
  });
});

describe('boundingBoxOfPositions', () => {
  it('returns null for an empty list', () => {
    expect(boundingBoxOfPositions([])).toBeNull();
  });

  it('spans every position', () => {
    expect(
      boundingBoxOfPositions([
        [1, 5],
        [-2, 3],
        [4, -1],
      ]),
    ).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 5 });
  });
});

function structureRecord(id: string, ring: readonly [number, number][]): MapObjectRecord {
  return {
    id,
    gardenId: 'garden',
    category: 'structure',
    geometry: { type: 'Polygon', coordinates: [ring] },
    lifecycleState: 'active',
    revision: 1,
    createdAt: '2026-07-21T00:00:00Z',
    updatedAt: '2026-07-21T00:00:00Z',
  };
}

describe('boundingBoxOfObjects / cameraFittingBounds', () => {
  it('unions every object and fits a camera around it', () => {
    const objects = [
      structureRecord('a', [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ]),
      structureRecord('b', [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
        [10, 10],
      ]),
    ];

    const box = boundingBoxOfObjects(objects);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 12, maxY: 12 });

    const camera = cameraFittingBounds(box!, SIZE);
    expect(camera.centerX).toBe(6);
    expect(camera.centerY).toBe(6);
    expect(camera.scale).toBeGreaterThan(0);
  });
});

describe('isRecordInViewport', () => {
  it('is true for an object inside the visible bounds', () => {
    const record = structureRecord('a', [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
    expect(isRecordInViewport(record, CAMERA, SIZE)).toBe(true);
  });

  it('is false for an object far outside the visible bounds', () => {
    const record = structureRecord('a', [
      [10_000, 10_000],
      [10_001, 10_000],
      [10_001, 10_001],
      [10_000, 10_001],
      [10_000, 10_000],
    ]);
    expect(isRecordInViewport(record, CAMERA, SIZE)).toBe(false);
  });
});

describe('panCamera', () => {
  it('moving the screen right moves the camera center left in local space', () => {
    const panned = panCamera(CAMERA, 100, 0);
    expect(panned.centerX).toBeLessThan(CAMERA.centerX);
  });
});

describe('zoomCamera', () => {
  it('keeps the local point under the pivot fixed on screen after zooming', () => {
    const pivot = { x: 500, y: 200 };
    const localUnderPivotBefore = toLocal(pivot, CAMERA, SIZE);

    const zoomed = zoomCamera(CAMERA, SIZE, pivot, 2);
    expect(zoomed.scale).toBeCloseTo(CAMERA.scale * 2);

    const localUnderPivotAfter = toLocal(pivot, zoomed, SIZE);
    expect(localUnderPivotAfter[0]).toBeCloseTo(localUnderPivotBefore[0]);
    expect(localUnderPivotAfter[1]).toBeCloseTo(localUnderPivotBefore[1]);
  });
});
