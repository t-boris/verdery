/**
 * The stubbed image-analysis pass `RecordObservation` runs once per attached
 * photo, and the row it produces.
 *
 * `analyzeObservationPhoto` is an honest placeholder, not a disguised guess:
 * no real image-analysis service exists yet, so it returns fixed, clearly-
 * fake constants for every photo rather than fabricating a plausible-looking
 * diagnosis. `requiresConfirmation` is hardcoded `true` in
 * `createImageAnalysisResult` below (never a parameter anything can set to
 * `false`) — the schema's own default, and the one invariant this stub must
 * never violate: an automated diagnosis is never presented as a confirmed
 * fact without explicit user confirmation.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `observations_history.image_analysis_result`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ImageAnalysisKind = 'stress' | 'disease' | 'pest' | 'other';

export interface ImageAnalysisResult {
  readonly id: Uuid;
  readonly observationPhotoId: Uuid;
  readonly analysisKind: ImageAnalysisKind;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requiresConfirmation: boolean;
  readonly requestedAdditionalEvidence: boolean;
  readonly createdAt: Date;
}

interface AnalysisOutcome {
  readonly analysisKind: ImageAnalysisKind;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requestedAdditionalEvidence: boolean;
}

const PLACEHOLDER_SUGGESTED_LABEL = 'No automated analysis available yet.';

/**
 * Honest placeholder for the image-analysis pipeline this module does not
 * yet have — no real ML service exists to call. `mediaId` is accepted but
 * unused, only so the signature already matches what a real analyzer will
 * eventually need. `analysisKind: 'other'` and `requestedAdditionalEvidence:
 * true` both signal "nothing was actually determined here" to any caller
 * inspecting the result, not a real classification.
 */
export function analyzeObservationPhoto(mediaId: Uuid): AnalysisOutcome {
  void mediaId;
  return {
    analysisKind: 'other',
    suggestedLabel: PLACEHOLDER_SUGGESTED_LABEL,
    confidenceScore: 0,
    requestedAdditionalEvidence: true,
  };
}

export function createImageAnalysisResult(
  id: Uuid,
  observationPhotoId: Uuid,
  mediaId: Uuid,
  now: Date,
): ImageAnalysisResult {
  const outcome = analyzeObservationPhoto(mediaId);

  return {
    id,
    observationPhotoId,
    analysisKind: outcome.analysisKind,
    suggestedLabel: outcome.suggestedLabel,
    confidenceScore: outcome.confidenceScore,
    requiresConfirmation: true,
    requestedAdditionalEvidence: outcome.requestedAdditionalEvidence,
    createdAt: now,
  };
}
