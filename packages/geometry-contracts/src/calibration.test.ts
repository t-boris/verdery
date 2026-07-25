import { describe, expect, it } from 'vitest';
import { loadFixture } from '@verdery/test-fixtures';
import type { CalibrationFixture } from '@verdery/test-fixtures';

import {
  applyPlanTransform,
  CalibrationInputError,
  derivePlanCalibration,
  manualAdjustmentBetween,
  normalizeRotation,
  planPageFootprint,
  planPointForLocal,
  rotatePlanTransformAbout,
  translatePlanTransform,
} from './calibration.js';
import type { PlanCalibrationInput, PlanTransform } from './calibration.js';

const fixture = loadFixture<CalibrationFixture>('geometry/calibration.json');

describe('derivePlanCalibration fixture', () => {
  it('uses the expected schema version', () => {
    expect(fixture.schemaVersion).toBe(1);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'derives %s',
    (_name, testCase) => {
      const derivation = derivePlanCalibration(testCase.input);

      expect(derivation.transform).toEqual(testCase.expected.transform);
      expect(derivation.pointResidualsMetres).toEqual(testCase.expected.pointResidualsMetres);
      expect(derivation.rmsErrorMetres).toBe(testCase.expected.rmsErrorMetres);

      const footprint = planPageFootprint(derivation.transform, testCase.input.pageAspectRatio);
      expect(footprint).toEqual({
        type: 'Polygon',
        coordinates: [testCase.expected.footprint],
      });
    },
  );

  it.each(fixture.rejectedCases.map((testCase) => [testCase.name, testCase] as const))(
    'rejects %s',
    (_name, testCase) => {
      try {
        derivePlanCalibration(testCase.input);
        expect.unreachable('expected a CalibrationInputError');
      } catch (error) {
        expect(error).toBeInstanceOf(CalibrationInputError);
        expect((error as CalibrationInputError).code).toBe(testCase.expectedCode);
      }
    },
  );
});

describe('derivePlanCalibration', () => {
  const twoPointInput: PlanCalibrationInput = {
    pageAspectRatio: 1,
    knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 8 },
    referencePoints: [
      { planPoint: [0, 0], localMetres: [2, 1] },
      { planPoint: [1, 0], localMetres: [2, 9] },
    ],
  };

  it('reports honest nonzero residuals when control points disagree with a rigid fit', () => {
    // Three points that no similarity transform can satisfy exactly: the
    // third point is pulled 1 m off the line the first two define.
    const derivation = derivePlanCalibration({
      pageAspectRatio: 1,
      knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 10 },
      referencePoints: [
        { planPoint: [0, 0], localMetres: [0, 0] },
        { planPoint: [1, 0], localMetres: [10, 0] },
        { planPoint: [0.5, 0], localMetres: [5, 1] },
      ],
    });

    expect(derivation.rmsErrorMetres).not.toBeNull();
    expect(derivation.rmsErrorMetres as number).toBeGreaterThan(0);
    expect(derivation.pointResidualsMetres).toHaveLength(3);
    for (const residual of derivation.pointResidualsMetres) {
      expect(residual).toBeGreaterThan(0);
    }
  });

  it('rejects more control points than the supported maximum', () => {
    const referencePoints = Array.from({ length: 33 }, (_, index) => ({
      planPoint: [index / 33, 0] as const,
      localMetres: [index, 0] as const,
    }));
    expect(() =>
      derivePlanCalibration({
        pageAspectRatio: 1,
        knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 10 },
        referencePoints,
      }),
    ).toThrowError(CalibrationInputError);
  });

  it('rejects a local control point outside the coordinate magnitude bound', () => {
    expect(() =>
      derivePlanCalibration({
        pageAspectRatio: 1,
        knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 10 },
        referencePoints: [{ planPoint: [0, 0], localMetres: [20000, 0] }],
      }),
    ).toThrowError(CalibrationInputError);
  });

  it('round-trips manualAdjustmentBetween: re-deriving with the recovered adjustment reproduces the desired placement', () => {
    const fitted = derivePlanCalibration(twoPointInput).transform;
    const desired = rotatePlanTransformAbout(translatePlanTransform(fitted, 3, -1.5), [4, 4], 0.25);

    const manual = manualAdjustmentBetween(fitted, desired);
    const rederived = derivePlanCalibration({
      ...twoPointInput,
      manualAdjustment: manual,
    }).transform;

    expect(rederived.metresPerPlanUnit).toBe(desired.metresPerPlanUnit);
    expect(rederived.rotationRadians).toBeCloseTo(desired.rotationRadians, 8);
    expect(rederived.translationMetres.x).toBeCloseTo(desired.translationMetres.x, 3);
    expect(rederived.translationMetres.y).toBeCloseTo(desired.translationMetres.y, 3);
  });
});

describe('applyPlanTransform and planPointForLocal', () => {
  const transform: PlanTransform = {
    metresPerPlanUnit: 12,
    rotationRadians: 0.7,
    translationMetres: { x: -3, y: 5 },
  };

  it('are inverse to each other', () => {
    const planPoint = [0.42, 0.31] as const;
    const local = applyPlanTransform(transform, planPoint);
    const roundTrip = planPointForLocal(transform, local);

    expect(roundTrip[0]).toBeCloseTo(planPoint[0], 12);
    expect(roundTrip[1]).toBeCloseTo(planPoint[1], 12);
  });

  it('maps image-down v to local-down y at zero rotation', () => {
    const identityScale: PlanTransform = {
      metresPerPlanUnit: 10,
      rotationRadians: 0,
      translationMetres: { x: 0, y: 0 },
    };
    expect(applyPlanTransform(identityScale, [0.5, 0.2])).toEqual([5, -2]);
  });
});

describe('normalizeRotation', () => {
  it('wraps into (-pi, pi] and normalizes negative zero', () => {
    expect(normalizeRotation(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeRotation(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeRotation(0)).toBe(0);
    expect(Object.is(normalizeRotation(-0), 0)).toBe(true);
  });
});
