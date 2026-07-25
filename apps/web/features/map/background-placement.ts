/**
 * Screen-space placement math for a CALIBRATED imported background
 * (P6-PLAN-02), the transform-aware sibling of `background-fit.ts`'s
 * placeholder contain-fit: projects the plan-space -> local-space
 * similarity transform into the Konva node properties that draw the plan
 * image exactly where its transform says, and inverts screen points back
 * into plan-fraction coordinates for calibration picking.
 */

import type { PlanTransform, Position } from '@verdery/geometry-contracts';
import { applyPlanTransform, planPointForLocal } from '@verdery/geometry-contracts';

import type { ScreenRect } from './background-fit';
import type { CanvasSize, MapCamera } from './types';
import { toLocal, toScreen } from './viewport';

/** Konva `Image` node properties: position of the image's top-left corner, size, and clockwise rotation in degrees. */
export interface CalibratedImagePlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotationDeg: number;
}

/**
 * Where the plan image draws under `transform`. The plan's top-left corner
 * (plan-fraction `[0, 0]`) maps to the transform's translation; one plan
 * unit spans the page width (`metresPerPlanUnit` metres). Local
 * counter-clockwise rotation appears clockwise on the y-down screen, hence
 * the sign flip into Konva's clockwise-positive `rotation`.
 */
export function calibratedImagePlacement(
  transform: PlanTransform,
  pageAspectRatio: number,
  camera: MapCamera,
  size: CanvasSize,
): CalibratedImagePlacement {
  const topLeft = toScreen(applyPlanTransform(transform, [0, 0]), camera, size);
  const widthPx = transform.metresPerPlanUnit * camera.scale;
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: widthPx,
    height: pageAspectRatio * widthPx,
    rotationDeg: (-transform.rotationRadians * 180) / Math.PI,
  };
}

/** The plan-fraction point under a screen point, for a background placed by `transform`. */
export function planPointAtScreenViaTransform(
  transform: PlanTransform,
  camera: MapCamera,
  size: CanvasSize,
  screen: { readonly x: number; readonly y: number },
): Position {
  return planPointForLocal(transform, toLocal(screen, camera, size));
}

/**
 * The plan-fraction point under a screen point for an UNcalibrated
 * background drawn contain-fit inside `fit` (`background-fit.ts`). Both
 * axes divide by the drawn WIDTH — the plan-fraction convention.
 */
export function planPointAtScreenViaContainFit(
  fit: ScreenRect,
  screen: { readonly x: number; readonly y: number },
): Position {
  return [(screen.x - fit.x) / fit.width, (screen.y - fit.y) / fit.width];
}

/** True when a picked plan point actually lies on the page. */
export function isPlanPointOnPage(point: Position, pageAspectRatio: number): boolean {
  return point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= pageAspectRatio;
}

/** The footprint's center in local metres — the pivot for orientation adjustment and placement seeding. */
export function footprintCenter(transform: PlanTransform, pageAspectRatio: number): Position {
  return applyPlanTransform(transform, [0.5, pageAspectRatio / 2]);
}
