/**
 * Placement math for an imported background's raster image inside its own
 * object polygon (P6-PLAN-01).
 *
 * An UNcalibrated background has no plan-to-map transform — the object's
 * Polygon is only a placeholder placement (its details say so explicitly:
 * `calibrationState: 'uncalibrated'`). The honest rendering until
 * P6-PLAN-02 exists is therefore: draw the image "contain"-fit inside the
 * polygon's own bounding box, preserving the image's native aspect ratio,
 * never stretching it to imply the polygon's proportions are meaningful.
 * P6-PLAN-02's calibration replaces this with a real transform.
 */

import { positionsOf, type Geometry } from '@verdery/geometry-contracts';

import type { CanvasSize, MapCamera } from './types';
import { boundingBoxOfPositions, toScreen } from './viewport';

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The geometry's bounding box as a screen-space rectangle under the current camera. `null` for an empty geometry. */
export function geometryScreenRect(
  geometry: Geometry,
  camera: MapCamera,
  size: CanvasSize,
): ScreenRect | null {
  const box = boundingBoxOfPositions(positionsOf(geometry));
  if (box === null) {
    return null;
  }
  // Local Y increases up, screen Y increases down — the box's top-left on
  // screen is (minX, maxY) in local space.
  const topLeft = toScreen([box.minX, box.maxY], camera, size);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: (box.maxX - box.minX) * camera.scale,
    height: (box.maxY - box.minY) * camera.scale,
  };
}

/**
 * The largest rectangle of `imageAspect` (width / height) that fits inside
 * `bounds`, centered — CSS `object-fit: contain` semantics.
 */
export function containFitRect(bounds: ScreenRect, imageAspect: number): ScreenRect {
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isFinite(imageAspect) ||
    imageAspect <= 0
  ) {
    return bounds;
  }

  const boundsAspect = bounds.width / bounds.height;
  if (imageAspect >= boundsAspect) {
    const height = bounds.width / imageAspect;
    return { x: bounds.x, y: bounds.y + (bounds.height - height) / 2, width: bounds.width, height };
  }
  const width = bounds.height * imageAspect;
  return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y, width, height: bounds.height };
}
