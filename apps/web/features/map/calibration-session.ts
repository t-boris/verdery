/**
 * Pure state transitions for an in-progress calibration session
 * (P6-PLAN-02) — the client-side half of section 16's flow: pick the
 * known-distance segment on the plan, enter the real distance, optionally
 * pair control points, adjust placement manually, apply.
 *
 * The draft lives in the editor store (`editor-store.tsx`); every
 * transition here is a pure function so the whole flow is unit-testable
 * without Konva or React. The live preview and the final command both run
 * the SAME shared derivation (`derivePlanCalibration` from
 * `@verdery/geometry-contracts`) the server runs, so what the user
 * previews is what the server stores, to within display precision.
 */

import type {
  CalibrationControlPoint,
  ImportedBackgroundCalibration,
  ManualCalibrationAdjustment,
  PlanCalibrationDerivation,
  PlanCalibrationInput,
  PlanTransform,
  Position,
} from '@verdery/geometry-contracts';
import {
  applyPlanTransform,
  CalibrationInputError,
  derivePlanCalibration,
  manualAdjustmentBetween,
  normalizeRotation,
  rotatePlanTransformAbout,
} from '@verdery/geometry-contracts';

/**
 * What the next canvas click means: the two known-distance segment
 * endpoints (plan points), a control point's plan half, or its local half.
 * `null` — clicks are not captured (the preview may be dragged instead).
 */
export type CalibrationCaptureMode = 'segment' | 'controlPlan' | 'controlLocal' | null;

export interface CalibrationDraft {
  readonly objectId: string;
  /** 0..2 plan-fraction points of the known-distance segment. */
  readonly segmentPoints: readonly Position[];
  /** Raw text of the distance field — parsed on use, so partial typing never corrupts the draft. */
  readonly distanceText: string;
  readonly referencePoints: readonly CalibrationControlPoint[];
  /** A clicked plan point awaiting its local-space pair. */
  readonly pendingPlanPoint: Position | null;
  readonly manualAdjustment: ManualCalibrationAdjustment | null;
  readonly capture: CalibrationCaptureMode;
}

/** Fresh session, or one seeded from the stored inputs for recalibration — re-derivable, never a restart. */
export function startCalibrationDraft(
  objectId: string,
  existing?: ImportedBackgroundCalibration,
): CalibrationDraft {
  if (existing === undefined) {
    return {
      objectId,
      segmentPoints: [],
      distanceText: '',
      referencePoints: [],
      pendingPlanPoint: null,
      manualAdjustment: null,
      capture: 'segment',
    };
  }
  return {
    objectId,
    segmentPoints: [existing.knownDistance.pointA, existing.knownDistance.pointB],
    distanceText: String(existing.knownDistance.distanceMetres),
    referencePoints: existing.referencePoints.map(({ planPoint, localMetres }) => ({
      planPoint,
      localMetres,
    })),
    pendingPlanPoint: null,
    manualAdjustment: existing.manualAdjustment ?? null,
    capture: null,
  };
}

export function parsedDistanceMetres(draft: CalibrationDraft): number | null {
  const value = Number(draft.distanceText.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A plan-space click while capturing. Ignored outside a plan-point capture mode. */
export function draftWithPlanPoint(draft: CalibrationDraft, planPoint: Position): CalibrationDraft {
  if (draft.capture === 'segment') {
    const segmentPoints = [...draft.segmentPoints, planPoint].slice(0, 2);
    return {
      ...draft,
      segmentPoints,
      capture: segmentPoints.length < 2 ? 'segment' : null,
    };
  }
  if (draft.capture === 'controlPlan') {
    return { ...draft, pendingPlanPoint: planPoint, capture: 'controlLocal' };
  }
  return draft;
}

/** A map (local-space) click while a control point's plan half is pending. */
export function draftWithLocalPoint(
  draft: CalibrationDraft,
  localMetres: Position,
): CalibrationDraft {
  if (draft.capture !== 'controlLocal' || draft.pendingPlanPoint === null) {
    return draft;
  }
  return {
    ...draft,
    referencePoints: [...draft.referencePoints, { planPoint: draft.pendingPlanPoint, localMetres }],
    pendingPlanPoint: null,
    capture: null,
  };
}

export function draftWithDistanceText(
  draft: CalibrationDraft,
  distanceText: string,
): CalibrationDraft {
  return { ...draft, distanceText };
}

export function draftRestartSegment(draft: CalibrationDraft): CalibrationDraft {
  return { ...draft, segmentPoints: [], capture: 'segment', pendingPlanPoint: null };
}

export function draftBeginControlPoint(draft: CalibrationDraft): CalibrationDraft {
  return { ...draft, capture: 'controlPlan', pendingPlanPoint: null };
}

export function draftCancelCapture(draft: CalibrationDraft): CalibrationDraft {
  return { ...draft, capture: null, pendingPlanPoint: null };
}

export function draftRemoveReferencePoint(
  draft: CalibrationDraft,
  index: number,
): CalibrationDraft {
  return {
    ...draft,
    referencePoints: draft.referencePoints.filter((_, itemIndex) => itemIndex !== index),
  };
}

/** The complete derivation input, or `null` while the segment or distance is still missing. */
export function draftInput(
  draft: CalibrationDraft,
  pageAspectRatio: number,
): PlanCalibrationInput | null {
  const pointA = draft.segmentPoints[0];
  const pointB = draft.segmentPoints[1];
  const distanceMetres = parsedDistanceMetres(draft);
  if (pointA === undefined || pointB === undefined || distanceMetres === null) {
    return null;
  }
  return {
    pageAspectRatio,
    knownDistance: { pointA, pointB, distanceMetres },
    referencePoints: draft.referencePoints,
    ...(draft.manualAdjustment === null ? {} : { manualAdjustment: draft.manualAdjustment }),
  };
}

export type DraftPreview =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'invalid'; readonly code: string }
  | { readonly kind: 'ready'; readonly derivation: PlanCalibrationDerivation };

/** The live preview: same math as the server, or an honest reason there is nothing to preview yet. */
export function draftPreview(draft: CalibrationDraft, pageAspectRatio: number): DraftPreview {
  const input = draftInput(draft, pageAspectRatio);
  if (input === null) {
    return { kind: 'incomplete' };
  }
  try {
    return { kind: 'ready', derivation: derivePlanCalibration(input) };
  } catch (error) {
    if (error instanceof CalibrationInputError) {
      return { kind: 'invalid', code: error.code };
    }
    throw error;
  }
}

/** The derivation WITHOUT the manual adjustment — the base `manualAdjustmentBetween` needs. */
function fittedTransform(draft: CalibrationDraft, pageAspectRatio: number): PlanTransform | null {
  const input = draftInput(draft, pageAspectRatio);
  if (input === null) {
    return null;
  }
  const { manualAdjustment: _manual, ...withoutManual } = input;
  try {
    return derivePlanCalibration(withoutManual).transform;
  } catch {
    return null;
  }
}

/** Drag gesture: shifts the preview by a local-space delta, recorded as manual-adjustment INPUT. */
export function draftWithManualTranslation(
  draft: CalibrationDraft,
  dxMetres: number,
  dyMetres: number,
): CalibrationDraft {
  const current = draft.manualAdjustment ?? {
    rotationRadians: 0,
    translationMetres: { dx: 0, dy: 0 },
  };
  return {
    ...draft,
    manualAdjustment: {
      rotationRadians: current.rotationRadians,
      translationMetres: {
        dx: current.translationMetres.dx + dxMetres,
        dy: current.translationMetres.dy + dyMetres,
      },
    },
  };
}

/**
 * Orientation input: sets the manual rotation to `rotationRadians`,
 * pivoting the preview about its own footprint center (rotating a plan
 * about the distant local origin would fling it off screen). The stored
 * manual rotation ends up exactly `rotationRadians`, so the panel's field
 * round-trips.
 */
export function draftWithManualRotation(
  draft: CalibrationDraft,
  pageAspectRatio: number,
  rotationRadians: number,
): CalibrationDraft {
  const preview = draftPreview(draft, pageAspectRatio);
  const fitted = fittedTransform(draft, pageAspectRatio);
  if (preview.kind !== 'ready' || fitted === null) {
    return draft;
  }

  const current = preview.derivation.transform;
  const currentManualRotation = draft.manualAdjustment?.rotationRadians ?? 0;
  const delta = normalizeRotation(rotationRadians - currentManualRotation);
  const center = applyPlanTransform(current, [0.5, pageAspectRatio / 2]);
  const desired = rotatePlanTransformAbout(current, center, delta);

  return { ...draft, manualAdjustment: manualAdjustmentBetween(fitted, desired) };
}

/**
 * With a known distance but no control points and no manual adjustment,
 * the fit alone would drop the plan at the local origin — this seeds a
 * manual translation that keeps the preview centered where the background
 * already sat (its placeholder box), so the user adjusts from something
 * visible instead of hunting for a teleported plan.
 */
export function draftWithSeededPlacement(
  draft: CalibrationDraft,
  pageAspectRatio: number,
  targetCenter: Position,
): CalibrationDraft {
  if (draft.manualAdjustment !== null || draft.referencePoints.length > 0) {
    return draft;
  }
  const fitted = fittedTransform(draft, pageAspectRatio);
  if (fitted === null) {
    return draft;
  }
  const fitCenter = applyPlanTransform(fitted, [0.5, pageAspectRatio / 2]);
  return {
    ...draft,
    manualAdjustment: {
      rotationRadians: 0,
      translationMetres: {
        dx: targetCenter[0] - fitCenter[0],
        dy: targetCenter[1] - fitCenter[1],
      },
    },
  };
}
