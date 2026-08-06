import type { PlanTransform } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import {
  calibratedImagePlacement,
  footprintCenter,
  isPlanPointOnPage,
  planPointAtScreenViaContainFit,
  planPointAtScreenViaTransform,
} from './background-placement';
import type { CanvasSize, MapCamera } from './types';
import { toScreen } from './viewport';

const CAMERA: MapCamera = { centerX: 0, centerY: 0, scale: 10, rotationDegrees: 0 };
const SIZE: CanvasSize = { width: 800, height: 600 };

const IDENTITY: PlanTransform = {
  metresPerPlanUnit: 20,
  rotationRadians: 0,
  translationMetres: { x: 0, y: 0 },
};

describe('calibratedImagePlacement', () => {
  it('places the image top-left at the transform translation with width = scale metres', () => {
    const placement = calibratedImagePlacement(IDENTITY, 0.75, CAMERA, SIZE);
    const origin = toScreen([0, 0], CAMERA, SIZE);

    expect(placement.x).toBe(origin.x);
    expect(placement.y).toBe(origin.y);
    expect(placement.width).toBe(200); // 20 m x 10 px/m
    expect(placement.height).toBe(150);
    expect(placement.rotationDeg).toBe(-0);
  });

  it('flips local counter-clockwise rotation into Konva clockwise degrees', () => {
    const rotated: PlanTransform = { ...IDENTITY, rotationRadians: Math.PI / 2 };
    const placement = calibratedImagePlacement(rotated, 1, CAMERA, SIZE);
    expect(placement.rotationDeg).toBeCloseTo(-90, 10);
  });
});

describe('planPointAtScreenViaTransform', () => {
  it('inverts the screen projection back to the plan point', () => {
    const rotated: PlanTransform = {
      metresPerPlanUnit: 12,
      rotationRadians: 0.6,
      translationMetres: { x: -3, y: 5 },
    };
    // Forward: plan -> local -> screen; then invert.
    const localOfPlanPoint = ((): readonly [number, number] => {
      const u = 0.4;
      const v = 0.25;
      const cos = Math.cos(0.6);
      const sin = Math.sin(0.6);
      return [-3 + 12 * (u * cos + v * sin), 5 + 12 * (u * sin - v * cos)];
    })();
    const screen = toScreen(localOfPlanPoint, CAMERA, SIZE);

    const point = planPointAtScreenViaTransform(rotated, CAMERA, SIZE, screen);
    expect(point[0]).toBeCloseTo(0.4, 10);
    expect(point[1]).toBeCloseTo(0.25, 10);
  });
});

describe('planPointAtScreenViaContainFit', () => {
  it('divides both axes by the drawn WIDTH — the plan-fraction convention', () => {
    const fit = { x: 100, y: 50, width: 200, height: 150 };
    expect(planPointAtScreenViaContainFit(fit, { x: 200, y: 200 })).toEqual([0.5, 0.75]);
  });
});

describe('isPlanPointOnPage', () => {
  it('bounds u by 1 and v by the aspect ratio', () => {
    expect(isPlanPointOnPage([0.5, 0.5], 0.75)).toBe(true);
    expect(isPlanPointOnPage([1.1, 0.5], 0.75)).toBe(false);
    expect(isPlanPointOnPage([0.5, 0.8], 0.75)).toBe(false);
    expect(isPlanPointOnPage([-0.01, 0], 0.75)).toBe(false);
  });
});

describe('footprintCenter', () => {
  it('maps the page center through the transform', () => {
    expect(footprintCenter(IDENTITY, 0.75)).toEqual([10, -7.5]);
  });
});
