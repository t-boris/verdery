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
 * historical stub always returned — callers need no new branching, though
 * `modelName`/`promptVersion` are still captured whenever the provider was
 * actually reached (schema-invalid, safety-blocked) even though no
 * observation resulted.
 *
 * P11-HEALTH-01 (ADR-0016 section 2) extends this row additively with the
 * rest of the design doc's own "health suggestion" shape — evidence
 * summary, alternative explanations, safety class, requested view
 * purposes, model/prompt version, and a settable disposition — while
 * leaving `requiresConfirmation` and the structural absence of any
 * toxicity/edibility/pesticide/treatment/regulatory field untouched.
 * `requestedViewPurposes` reuses this module's own `ObservationPhotoPurpose`
 * (a same-module import, not a cross-module one) — `PlantPhotoReference`/
 * `AnalyzePlantCondition` are already imported here from `integrations`,
 * the established precedent for this specific file reaching into that
 * module's public boundary from the domain layer.
 *
 * Prior-photo history comparison (the port's own `priorPhotos` field) is
 * now wired: `attachObservationPhotos` queries the plant's own prior
 * analyzed photos and passes them through, so the model judges change over
 * time rather than one frame in isolation, matching "a user-selected plant
 * and its history" (implementation-plan.md, P11-HEALTH-01).
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `observations_history.image_analysis_result`;
 * migrations/1788000000000_health-suggestion-disposition.sql;
 * architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md;
 * architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type {
  AnalyzePlantCondition,
  PlantConditionHistoryEntry,
  PlantConditionSafetyClass,
  PlantPhotoReference,
} from '../../integrations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { OBSERVATION_PHOTO_PURPOSES, type ObservationPhotoPurpose } from './observation-photo.js';

export type ImageAnalysisKind = 'stress' | 'disease' | 'pest' | 'other';

export type HealthSuggestionDisposition =
  'confirmed_externally' | 'accepted_as_observation' | 'rejected' | 'unresolved';

export const HEALTH_SUGGESTION_DISPOSITIONS: readonly HealthSuggestionDisposition[] = [
  'confirmed_externally',
  'accepted_as_observation',
  'rejected',
  'unresolved',
];

export interface ImageAnalysisResult {
  readonly id: Uuid;
  readonly observationPhotoId: Uuid;
  readonly analysisKind: ImageAnalysisKind;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requiresConfirmation: boolean;
  readonly requestedAdditionalEvidence: boolean;
  readonly evidenceSummary: string;
  readonly alternativeExplanations: readonly string[];
  readonly safetyClass: PlantConditionSafetyClass;
  /** Populated only when `requestedAdditionalEvidence` is true. */
  readonly requestedViewPurposes: readonly ObservationPhotoPurpose[];
  /** Null when no provider was ever reached (disabled, quota exhausted, timed out). */
  readonly modelName: string | null;
  readonly promptVersion: number | null;
  readonly disposition: HealthSuggestionDisposition;
  /** Null exactly when `disposition === 'unresolved'`, set together with `dispositionSetByProfileId` otherwise. */
  readonly dispositionSetAt: Date | null;
  readonly dispositionSetByProfileId: Uuid | null;
  readonly createdAt: Date;
}

interface AnalysisOutcome {
  readonly analysisKind: ImageAnalysisKind;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requestedAdditionalEvidence: boolean;
  readonly evidenceSummary: string;
  readonly alternativeExplanations: readonly string[];
  readonly safetyClass: PlantConditionSafetyClass;
  readonly requestedViewPurposes: readonly ObservationPhotoPurpose[];
  readonly modelName: string | null;
  readonly promptVersion: number | null;
}

/** The honest answer for every non-observation outcome — matches the historical stub's own constants exactly, so a disabled/unavailable capability is indistinguishable from "nothing notable was found." `modelName`/`promptVersion` are filled in by the caller when the provider was actually reached. */
const NO_ANALYSIS_OUTCOME: Omit<AnalysisOutcome, 'modelName' | 'promptVersion'> = {
  analysisKind: 'other',
  suggestedLabel: 'No automated analysis available yet.',
  confidenceScore: 0,
  requestedAdditionalEvidence: true,
  evidenceSummary: '',
  alternativeExplanations: [],
  safetyClass: 'informational',
  requestedViewPurposes: [],
};

/**
 * Calls the real, bounded plant-condition-analysis machinery.
 */
export async function analyzeObservationPhoto(
  analyzePlantCondition: AnalyzePlantCondition,
  photo: PlantPhotoReference,
  priorPhotos: readonly PlantConditionHistoryEntry[],
): Promise<AnalysisOutcome> {
  const result = await analyzePlantCondition.execute({ photo, priorPhotos });

  if (result.outcome !== 'observation') {
    const provenance = result.outcome === 'unavailable' ? null : result.provenance;
    return {
      ...NO_ANALYSIS_OUTCOME,
      modelName: provenance?.model ?? null,
      promptVersion: provenance?.promptTemplateVersion ?? null,
    };
  }

  return {
    analysisKind: result.observation.kind,
    suggestedLabel: result.observation.suggestedLabel,
    confidenceScore: result.observation.confidenceScore,
    requestedAdditionalEvidence: result.observation.requestedAdditionalEvidence,
    evidenceSummary: result.observation.evidenceSummary,
    alternativeExplanations: result.observation.alternativeExplanations,
    safetyClass: result.observation.safetyClass,
    requestedViewPurposes: result.observation.requestedViewPurposes,
    modelName: result.provenance.model,
    promptVersion: result.provenance.promptTemplateVersion,
  };
}

export async function createImageAnalysisResult(
  analyzePlantCondition: AnalyzePlantCondition,
  id: Uuid,
  observationPhotoId: Uuid,
  photo: PlantPhotoReference,
  priorPhotos: readonly PlantConditionHistoryEntry[],
  now: Date,
): Promise<ImageAnalysisResult> {
  const outcome = await analyzeObservationPhoto(analyzePlantCondition, photo, priorPhotos);

  return {
    id,
    observationPhotoId,
    analysisKind: outcome.analysisKind,
    suggestedLabel: outcome.suggestedLabel,
    confidenceScore: outcome.confidenceScore,
    requiresConfirmation: true,
    requestedAdditionalEvidence: outcome.requestedAdditionalEvidence,
    evidenceSummary: outcome.evidenceSummary,
    alternativeExplanations: outcome.alternativeExplanations,
    safetyClass: outcome.safetyClass,
    requestedViewPurposes: outcome.requestedViewPurposes,
    modelName: outcome.modelName,
    promptVersion: outcome.promptVersion,
    disposition: 'unresolved',
    dispositionSetAt: null,
    dispositionSetByProfileId: null,
    createdAt: now,
  };
}

function invalidDisposition(): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    `disposition must be one of: ${HEALTH_SUGGESTION_DISPOSITIONS.join(', ')}.`,
    { details: [{ code: 'image_analysis_result.disposition.invalid', pointer: '/disposition' }] },
  );
}

/**
 * Sets (or resets) a health suggestion's disposition — the design doc's own
 * four-state vocabulary (section 9). No transition ordering is enforced,
 * the same "any transition is a legitimate, if inert, command" posture
 * `plant-lifecycle.ts`'s `LifecycleStage` already documents: a user may
 * reconsider a disposition freely. `dispositionSetAt`/
 * `dispositionSetByProfileId` are set together exactly when `disposition`
 * moves away from `'unresolved'`, and cleared together when it moves back
 * — mirrors the migration's own linkage CHECK constraints.
 */
export function applyHealthSuggestionDisposition(
  result: ImageAnalysisResult,
  rawDisposition: string,
  actorProfileId: Uuid,
  now: Date,
): ImageAnalysisResult {
  if (!HEALTH_SUGGESTION_DISPOSITIONS.includes(rawDisposition as HealthSuggestionDisposition)) {
    throw invalidDisposition();
  }
  const disposition = rawDisposition as HealthSuggestionDisposition;
  const isUnresolved = disposition === 'unresolved';

  return {
    ...result,
    disposition,
    dispositionSetAt: isUnresolved ? null : now,
    dispositionSetByProfileId: isUnresolved ? null : actorProfileId,
  };
}

/** Re-exported so callers validating a raw purpose list (e.g. request parsing) do not need a second import of `observation-photo.ts`. */
export { OBSERVATION_PHOTO_PURPOSES };
