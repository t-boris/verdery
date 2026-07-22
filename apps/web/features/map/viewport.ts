/**
 * The local-metres ⟷ screen-pixels viewport transform this feature owns.
 *
 * Konva knows nothing about metres; every shape component converts through
 * this module before handing coordinates to a Konva node. Local space is
 * right-handed with Y increasing north (up); screen space has Y increasing
 * downward, so every conversion flips the Y axis once, here, rather than in
 * each shape.
 *
 * Source: architecture/map-rendering-and-editing.md, sections "3.1 Garden
 * Local Space", "3.3 Screen Space", "20. Performance Strategy" (viewport culling).
 */

import { positionsOf, type Position } from '@verdery/geometry-contracts';

import type { CanvasSize, MapCamera, MapObjectRecord } from './types';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Pixels per metre for a garden with no objects and no prior camera to restore. */
const DEFAULT_SCALE = 24;
const MIN_SCALE = 2;
const MAX_SCALE = 400;

export function defaultCamera(): MapCamera {
  return { centerX: 0, centerY: 0, scale: DEFAULT_SCALE };
}

export function toScreen(local: Position, camera: MapCamera, size: CanvasSize): ScreenPoint {
  return {
    x: size.width / 2 + (local[0] - camera.centerX) * camera.scale,
    y: size.height / 2 - (local[1] - camera.centerY) * camera.scale,
  };
}

export function toLocal(screen: ScreenPoint, camera: MapCamera, size: CanvasSize): Position {
  return [
    camera.centerX + (screen.x - size.width / 2) / camera.scale,
    camera.centerY - (screen.y - size.height / 2) / camera.scale,
  ];
}

/** Converts a screen-space drag delta (as Konva reports it) into a local-metres translation. */
export function screenDeltaToLocalDelta(
  dxScreen: number,
  dyScreen: number,
  camera: MapCamera,
): { readonly dx: number; readonly dy: number } {
  return { dx: dxScreen / camera.scale, dy: -dyScreen / camera.scale };
}

export function boundingBoxOfPositions(positions: readonly Position[]): BoundingBox | null {
  if (positions.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of positions) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

function unionBoxes(boxes: readonly BoundingBox[]): BoundingBox | null {
  return boxes.reduce<BoundingBox | null>((acc, box) => {
    if (acc === null) return box;
    return {
      minX: Math.min(acc.minX, box.minX),
      minY: Math.min(acc.minY, box.minY),
      maxX: Math.max(acc.maxX, box.maxX),
      maxY: Math.max(acc.maxY, box.maxY),
    };
  }, null);
}

export function boundingBoxOfObjects(records: readonly MapObjectRecord[]): BoundingBox | null {
  const boxes = records
    .map((record) => boundingBoxOfPositions(positionsOf(record.geometry)))
    .filter((box): box is BoundingBox => box !== null);
  return unionBoxes(boxes);
}

/** A camera centered on `box` and zoomed to fit it inside `size`, with padding. */
export function cameraFittingBounds(box: BoundingBox, size: CanvasSize): MapCamera {
  const PADDING_PX = 48;
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);

  const scaleX = (size.width - PADDING_PX * 2) / width;
  const scaleY = (size.height - PADDING_PX * 2) / height;
  const scale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE);

  return {
    centerX: (box.minX + box.maxX) / 2,
    centerY: (box.minY + box.maxY) / 2,
    scale,
  };
}

/** Camera fit to every object's combined bounds, or the default camera when the garden is empty. */
export function initialCameraFor(records: readonly MapObjectRecord[], size: CanvasSize): MapCamera {
  const box = boundingBoxOfObjects(records);
  return box === null ? defaultCamera() : cameraFittingBounds(box, size);
}

/** Zooms by `factor` (>1 zooms in) while keeping the local point under `pivot` fixed on screen. */
export function zoomCamera(
  camera: MapCamera,
  size: CanvasSize,
  pivot: ScreenPoint,
  factor: number,
): MapCamera {
  const nextScale = Math.min(Math.max(camera.scale * factor, MIN_SCALE), MAX_SCALE);
  const localUnderPivot = toLocal(pivot, camera, size);
  const nextCamera = { ...camera, scale: nextScale };
  const screenAfter = toScreen(localUnderPivot, nextCamera, size);

  // Re-center so the same local point still sits under the pivot, matching a
  // conventional "zoom to cursor" gesture rather than always zooming to center.
  return {
    centerX: nextCamera.centerX + (screenAfter.x - pivot.x) / nextScale,
    centerY: nextCamera.centerY - (screenAfter.y - pivot.y) / nextScale,
    scale: nextScale,
  };
}

export function panCamera(camera: MapCamera, dxScreen: number, dyScreen: number): MapCamera {
  const { dx, dy } = screenDeltaToLocalDelta(dxScreen, dyScreen, camera);
  return { ...camera, centerX: camera.centerX - dx, centerY: camera.centerY - dy };
}

/** Visible local-space rectangle for the current camera and canvas size, used for viewport culling. */
export function visibleLocalBounds(camera: MapCamera, size: CanvasSize): BoundingBox {
  const topLeft = toLocal({ x: 0, y: 0 }, camera, size);
  const bottomRight = toLocal({ x: size.width, y: size.height }, camera, size);
  return {
    minX: Math.min(topLeft[0], bottomRight[0]),
    maxX: Math.max(topLeft[0], bottomRight[0]),
    minY: Math.min(topLeft[1], bottomRight[1]),
    maxY: Math.max(topLeft[1], bottomRight[1]),
  };
}

function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * True when `record`'s geometry might be visible in the current viewport.
 *
 * A margin in local metres (derived from screen pixels at the current scale)
 * keeps a shape from popping out mid-drag right at the viewport edge.
 *
 * Source: architecture/map-rendering-and-editing.md, section
 * "20. Performance Strategy" ("Viewport culling excludes off-screen shapes").
 */
export function isRecordInViewport(
  record: MapObjectRecord,
  camera: MapCamera,
  size: CanvasSize,
): boolean {
  const objectBox = boundingBoxOfPositions(positionsOf(record.geometry));
  if (objectBox === null) {
    return false;
  }

  const marginMetres = 32 / camera.scale;
  const visible = visibleLocalBounds(camera, size);
  const padded: BoundingBox = {
    minX: visible.minX - marginMetres,
    minY: visible.minY - marginMetres,
    maxX: visible.maxX + marginMetres,
    maxY: visible.maxY + marginMetres,
  };

  return boxesIntersect(objectBox, padded);
}
