/**
 * The image-analysis pass `RecordObservation`/`CorrectObservation` run
 * once per attached photo, and the row it produces.
 *
 * `analyzeObservationPhoto` calls the real, bounded `AnalyzePlantCondition`
 * machinery (ADR-0015), replacing the historical stub that returned fixed,
 * clearly-fake constants for every photo. `requiresConfirmation` stays
 * hardcoded `true` in `createImageAnalysisResult` below (never a parameter
 * anything can set to `false`) — the schema's own default, and the one
 * invariant this pass must never violate: an automated diagnosis is never
 * presented as a confirmed fact without explicit user confirmation. Every
 * non-observation outcome (disabled, quota exhausted, timeout, provider
 * failure, schema-invalid, safety-blocked) collapses to the SAME
 * `'other'`/zero-confidence/`requestedAdditionalEvidence: true` shape the
 * historical stub always returned — callers need no new branching.
 *
 * Prior-photo history comparison (the port's own `priorPhotos` field) is
 * not wired yet: `attachObservationPhotos` calls this with an empty history
 * for now, so every analysis judges the new photo alone rather than change
 * over time. The port already accepts history so this is a pure addition,
 * not a breaking change, when a later pass wires a real prior-photo query.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `observations_history.image_analysis_result`;
 * architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.
 */

import type {
  AnalyzePlantCondition,
  PlantConditionHistoryEntry,
  PlantPhotoReference,
} from '../../integrations/public.js';
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

/** The honest answer for every non-observation outcome — matches the historical stub's own constants exactly, so a disabled/unavailable capability is indistinguishable from "nothing notable was found." */
const NO_ANALYSIS_OUTCOME: AnalysisOutcome = {
  analysisKind: 'other',
  suggestedLabel: 'No automated analysis available yet.',
  confidenceScore: 0,
  requestedAdditionalEvidence: true,
};

/**
 * Calls the real, bounded plant-condition-analysis machinery. See this
 * file's own header for why `priorPhotos` is empty for now.
 */
export async function analyzeObservationPhoto(
  analyzePlantCondition: AnalyzePlantCondition,
  photo: PlantPhotoReference,
): Promise<AnalysisOutcome> {
  const priorPhotos: readonly PlantConditionHistoryEntry[] = [];
  const result = await analyzePlantCondition.execute({ photo, priorPhotos });

  if (result.outcome !== 'observation') {
    return NO_ANALYSIS_OUTCOME;
  }

  return {
    analysisKind: result.observation.kind,
    suggestedLabel: result.observation.suggestedLabel,
    confidenceScore: result.observation.confidenceScore,
    requestedAdditionalEvidence: result.observation.requestedAdditionalEvidence,
  };
}

export async function createImageAnalysisResult(
  analyzePlantCondition: AnalyzePlantCondition,
  id: Uuid,
  observationPhotoId: Uuid,
  photo: PlantPhotoReference,
  now: Date,
): Promise<ImageAnalysisResult> {
  const outcome = await analyzeObservationPhoto(analyzePlantCondition, photo);

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
