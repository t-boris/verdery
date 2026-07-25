import { derivePlanCalibration } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import {
  draftBeginControlPoint,
  draftInput,
  draftPreview,
  draftRemoveReferencePoint,
  draftRestartSegment,
  draftWithDistanceText,
  draftWithLocalPoint,
  draftWithManualRotation,
  draftWithManualTranslation,
  draftWithPlanPoint,
  draftWithSeededPlacement,
  parsedDistanceMetres,
  startCalibrationDraft,
  type CalibrationDraft,
} from './calibration-session';

const OBJECT_ID = 'background-1';

function completedDraft(): CalibrationDraft {
  let draft = startCalibrationDraft(OBJECT_ID);
  draft = draftWithPlanPoint(draft, [0, 0]);
  draft = draftWithPlanPoint(draft, [1, 0]);
  return draftWithDistanceText(draft, '8');
}

describe('startCalibrationDraft', () => {
  it('starts a fresh session capturing the known-distance segment', () => {
    const draft = startCalibrationDraft(OBJECT_ID);
    expect(draft.capture).toBe('segment');
    expect(draft.segmentPoints).toEqual([]);
    expect(draft.referencePoints).toEqual([]);
    expect(draft.manualAdjustment).toBeNull();
  });

  it('seeds recalibration from the stored inputs, so it is a re-derivation, not a restart', () => {
    const draft = startCalibrationDraft(OBJECT_ID, {
      transformRevision: 2,
      pageAspectRatio: 1,
      knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 8 },
      referencePoints: [{ planPoint: [0, 0], localMetres: [2, 1], residualMetres: 0 }],
      manualAdjustment: { rotationRadians: 0.1, translationMetres: { dx: 1, dy: 2 } },
      transform: { metresPerPlanUnit: 8, rotationRadians: 0, translationMetres: { x: 0, y: 0 } },
      rmsErrorMetres: null,
    });

    expect(draft.capture).toBeNull();
    expect(draft.segmentPoints).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(draft.distanceText).toBe('8');
    expect(draft.referencePoints).toEqual([{ planPoint: [0, 0], localMetres: [2, 1] }]);
    expect(draft.manualAdjustment).toEqual({
      rotationRadians: 0.1,
      translationMetres: { dx: 1, dy: 2 },
    });
  });
});

describe('point capture transitions', () => {
  it('captures two segment points then stops capturing', () => {
    let draft = startCalibrationDraft(OBJECT_ID);
    draft = draftWithPlanPoint(draft, [0.1, 0.1]);
    expect(draft.capture).toBe('segment');
    draft = draftWithPlanPoint(draft, [0.6, 0.1]);
    expect(draft.capture).toBeNull();
    expect(draft.segmentPoints).toHaveLength(2);
  });

  it('pairs a control point: plan half, then local half', () => {
    let draft = draftBeginControlPoint(completedDraft());
    expect(draft.capture).toBe('controlPlan');

    draft = draftWithPlanPoint(draft, [0.5, 0.5]);
    expect(draft.capture).toBe('controlLocal');
    expect(draft.pendingPlanPoint).toEqual([0.5, 0.5]);

    draft = draftWithLocalPoint(draft, [4, 7]);
    expect(draft.capture).toBeNull();
    expect(draft.referencePoints).toEqual([{ planPoint: [0.5, 0.5], localMetres: [4, 7] }]);
  });

  it('ignores clicks outside a capture mode, and removes control points by index', () => {
    const base = completedDraft();
    expect(draftWithPlanPoint(base, [0.5, 0.5])).toBe(base);
    expect(draftWithLocalPoint(base, [1, 1])).toBe(base);

    let draft = draftBeginControlPoint(base);
    draft = draftWithPlanPoint(draft, [0.2, 0.2]);
    draft = draftWithLocalPoint(draft, [1, 1]);
    expect(draftRemoveReferencePoint(draft, 0).referencePoints).toEqual([]);
  });

  it('re-picking the segment clears it and resumes capture', () => {
    const draft = draftRestartSegment(completedDraft());
    expect(draft.segmentPoints).toEqual([]);
    expect(draft.capture).toBe('segment');
  });
});

describe('parsedDistanceMetres', () => {
  it('parses a decimal comma and rejects non-positive or unparseable text', () => {
    expect(parsedDistanceMetres(draftWithDistanceText(completedDraft(), '2,5'))).toBe(2.5);
    expect(parsedDistanceMetres(draftWithDistanceText(completedDraft(), '0'))).toBeNull();
    expect(parsedDistanceMetres(draftWithDistanceText(completedDraft(), 'abc'))).toBeNull();
  });
});

describe('draftPreview', () => {
  it('is incomplete until the segment and distance exist', () => {
    expect(draftPreview(startCalibrationDraft(OBJECT_ID), 1)).toEqual({ kind: 'incomplete' });
    expect(draftPreview(completedDraft(), 1).kind).toBe('ready');
  });

  it('reports degenerate inputs honestly instead of previewing nonsense', () => {
    let draft = startCalibrationDraft(OBJECT_ID);
    draft = draftWithPlanPoint(draft, [0.5, 0.5]);
    draft = draftWithPlanPoint(draft, [0.5, 0.5]);
    draft = draftWithDistanceText(draft, '10');
    expect(draftPreview(draft, 1)).toEqual({
      kind: 'invalid',
      code: 'known_distance_segment_degenerate',
    });
  });

  it('runs the SAME derivation the server runs — preview equals derivePlanCalibration', () => {
    const draft = completedDraft();
    const preview = draftPreview(draft, 1);
    const input = draftInput(draft, 1);
    expect(preview.kind).toBe('ready');
    expect(input).not.toBeNull();
    if (preview.kind === 'ready' && input !== null) {
      expect(preview.derivation).toEqual(derivePlanCalibration(input));
    }
  });
});

describe('manual adjustment', () => {
  it('accumulates drag deltas as manual translation input', () => {
    let draft = draftWithManualTranslation(completedDraft(), 2, -1);
    draft = draftWithManualTranslation(draft, 1, 1);
    expect(draft.manualAdjustment).toEqual({
      rotationRadians: 0,
      translationMetres: { dx: 3, dy: 0 },
    });
  });

  it('rotation input pivots about the footprint center and round-trips its own value', () => {
    const draft = draftWithManualRotation(completedDraft(), 1, Math.PI / 2);
    expect(draft.manualAdjustment?.rotationRadians).toBeCloseTo(Math.PI / 2, 9);

    const preview = draftPreview(draft, 1);
    expect(preview.kind).toBe('ready');
    if (preview.kind === 'ready') {
      expect(preview.derivation.transform.rotationRadians).toBeCloseTo(Math.PI / 2, 8);
    }
  });

  it('seeds a centering placement only when nothing else pins the plan yet', () => {
    const seeded = draftWithSeededPlacement(completedDraft(), 1, [10, 20]);
    expect(seeded.manualAdjustment).not.toBeNull();

    const preview = draftPreview(seeded, 1);
    expect(preview.kind).toBe('ready');
    if (preview.kind === 'ready') {
      // Footprint center = the seeded target.
      const t = preview.derivation.transform;
      expect(t.translationMetres.x + 4).toBeCloseTo(10, 3);
      expect(t.translationMetres.y - 4).toBeCloseTo(20, 3);
    }

    // Already manually placed — seeding must not fight the user.
    expect(draftWithSeededPlacement(seeded, 1, [0, 0])).toBe(seeded);
  });
});
