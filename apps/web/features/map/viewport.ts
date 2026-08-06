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

/**
 * Pixels per metre for a garden with no objects and no prior camera to
 * restore. Exported because it is the reference the status bar's zoom readout
 * is a percentage OF — `camera.scale` is a px/m factor, not a percentage, so
 * "100%" has to mean something, and the default view is the only non-arbitrary
 * thing it can mean.
 */
export const DEFAULT_SCALE = 24;
const MIN_SCALE = 2;
const MAX_SCALE = 400;

export function defaultCamera(): MapCamera {
  return { centerX: 0, centerY: 0, scale: DEFAULT_SCALE, rotationDegrees: 0 };
}

function rotate([x, y]: Position, degrees: number): Position {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [x * cosine - y * sine, x * sine + y * cosine];
}

export function toScreen(local: Position, camera: MapCamera, size: CanvasSize): ScreenPoint {
  const [x, y] = rotate(
    [local[0] - camera.centerX, local[1] - camera.centerY],
    -camera.rotationDegrees,
  );
  return {
    x: size.width / 2 + x * camera.scale,
    y: size.height / 2 - y * camera.scale,
  };
}

export function toLocal(screen: ScreenPoint, camera: MapCamera, size: CanvasSize): Position {
  const relative = rotate(
    [(screen.x - size.width / 2) / camera.scale, -(screen.y - size.height / 2) / camera.scale],
    camera.rotationDegrees,
  );
  return [camera.centerX + relative[0], camera.centerY + relative[1]];
}

/** Converts a screen-space drag delta (as Konva reports it) into a local-metres translation. */
export function screenDeltaToLocalDelta(
  dxScreen: number,
  dyScreen: number,
  camera: MapCamera,
): { readonly dx: number; readonly dy: number } {
  const [dx, dy] = rotate(
    [dxScreen / camera.scale, -dyScreen / camera.scale],
    camera.rotationDegrees,
  );
  return { dx, dy };
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
export function cameraFittingBounds(
  box: BoundingBox,
  size: CanvasSize,
  rotationDegrees = 0,
): MapCamera {
  const PADDING_PX = 48;
  const centerX = (box.minX + box.maxX) / 2;
  const centerY = (box.minY + box.maxY) / 2;
  const corners: readonly Position[] = [
    [box.minX - centerX, box.minY - centerY],
    [box.minX - centerX, box.maxY - centerY],
    [box.maxX - centerX, box.minY - centerY],
    [box.maxX - centerX, box.maxY - centerY],
  ];
  const rotatedCorners = corners.map((point) => rotate(point, -rotationDegrees));
  const rotatedBox = boundingBoxOfPositions(rotatedCorners);
  const width = Math.max((rotatedBox?.maxX ?? 0) - (rotatedBox?.minX ?? 0), 1);
  const height = Math.max((rotatedBox?.maxY ?? 0) - (rotatedBox?.minY ?? 0), 1);

  const scaleX = (size.width - PADDING_PX * 2) / width;
  const scaleY = (size.height - PADDING_PX * 2) / height;
  const scale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE);

  return {
    centerX,
    centerY,
    scale,
    rotationDegrees,
  };
}

/** Camera fit to every object's combined bounds, or the default camera when the garden is empty. */
export function initialCameraFor(
  records: readonly MapObjectRecord[],
  size: CanvasSize,
  rotationDegrees = 0,
): MapCamera {
  const box = boundingBoxOfObjects(records);
  return box === null
    ? { ...defaultCamera(), rotationDegrees }
    : cameraFittingBounds(box, size, rotationDegrees);
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
    ...nextCamera,
    ...(() => {
      const { dx, dy } = screenDeltaToLocalDelta(
        screenAfter.x - pivot.x,
        screenAfter.y - pivot.y,
        nextCamera,
      );
      return { centerX: nextCamera.centerX + dx, centerY: nextCamera.centerY + dy };
    })(),
  };
}

export function panCamera(camera: MapCamera, dxScreen: number, dyScreen: number): MapCamera {
  const { dx, dy } = screenDeltaToLocalDelta(dxScreen, dyScreen, camera);
  return { ...camera, centerX: camera.centerX - dx, centerY: camera.centerY - dy };
}

/** Visible local-space rectangle for the current camera and canvas size, used for viewport culling. */
export function visibleLocalBounds(camera: MapCamera, size: CanvasSize): BoundingBox {
  const corners = [
    toLocal({ x: 0, y: 0 }, camera, size),
    toLocal({ x: size.width, y: 0 }, camera, size),
    toLocal({ x: size.width, y: size.height }, camera, size),
    toLocal({ x: 0, y: size.height }, camera, size),
  ];
  return (
    boundingBoxOfPositions(corners) ?? {
      minX: camera.centerX,
      minY: camera.centerY,
      maxX: camera.centerX,
      maxY: camera.centerY,
    }
  );
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
