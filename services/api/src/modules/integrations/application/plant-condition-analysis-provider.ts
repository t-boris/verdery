/**
 * Provider-neutral plant-condition-analysis port — the third AI use case
 * this module carries, alongside `ai-explanation-provider.ts` and
 * `plant-species-identification-provider.ts`. Approved by ADR-0015.
 *
 * The one approved use case: given a photo of an ALREADY-KNOWN,
 * already-placed plant (the user opens that plant's own record and adds
 * the photo — confirmed as the only supported flow, so no location/GPS
 * disambiguation among same-species plants is needed here), evaluate it
 * for stress/disease/pest signals and compare against the plant's own
 * prior photos. This replaces `observations-history/domain/
 * image-analysis-result.ts`'s `analyzeObservationPhoto` stub.
 *
 * Structurally excluded from this port, matching
 * `plant-species-identification-provider.ts`'s own boundary and the design
 * doc's own five-item list (plant-intelligence-and-visual-journal.md,
 * section 9): toxicity, edibility, pesticide/treatment guidance, and
 * regulatory status. The request and response shapes below have no field
 * for any of them, and the adapter's system instruction refuses to discuss
 * them even if a photo or a future prompt change tried to elicit it.
 *
 * P11-HEALTH-01 extends `PlantConditionObservation` with the rest of the
 * design doc's own "health suggestion" shape (evidence summary,
 * alternative explanations, safety class, requested view purposes) — see
 * ADR-0016 section 2 and `observations-history/domain/
 * image-analysis-result.ts`, which persists all of it onto
 * `image_analysis_result`.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md;
 * architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
 * architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.
 */

import type { PlantPhotoReference } from './plant-species-identification-provider.js';

export type { PlantPhotoReference };

/** A prior photo of the SAME plant, oldest first, so the model can compare change over time rather than judge one frame in isolation. */
export interface PlantConditionHistoryEntry {
  readonly photo: PlantPhotoReference;
  readonly observedAt: string;
}

export interface PlantConditionAnalysisRequest {
  readonly photo: PlantPhotoReference;
  readonly priorPhotos: readonly PlantConditionHistoryEntry[];
}

export type PlantConditionKind = 'stress' | 'disease' | 'pest' | 'other';

/**
 * How urgently a suggestion should prompt a human follow-up (P11-HEALTH-01)
 * — NOT a treatment recommendation and NOT
 * `tasks_recommendations.rule_version`'s `RecommendationSafetyTier`
 * (`ordinary_care`/`elevated_risk`/`restricted`, which classifies CARE
 * ACTIONS a rule may recommend): a different axis, in a different domain.
 * High-impact treatment recommendations stay rules-first, under that
 * separate safety policy, regardless of this value.
 */
export type PlantConditionSafetyClass = 'informational' | 'monitor' | 'expert_review_recommended';

export const PLANT_CONDITION_SAFETY_CLASSES: readonly PlantConditionSafetyClass[] = [
  'informational',
  'monitor',
  'expert_review_recommended',
];

/**
 * Which of `observation_photo.purpose`'s 8 documented values
 * (P11-MEDIA-01) would help most as a follow-up photo. A LOCAL copy of
 * that same vocabulary, not an import of `observations-history`'s own
 * `ObservationPhotoPurpose` — this module sits below observations-history
 * (which already depends on `integrations`), so the dependency cannot run
 * the other way; the same non-sharing precedent `Hemisphere` already set.
 */
export type PlantConditionViewPurpose =
  | 'whole_plant'
  | 'leaf_front'
  | 'leaf_back'
  | 'stem_or_bark'
  | 'flower'
  | 'fruit'
  | 'symptom_close_up'
  | 'context_or_free_form';

export const PLANT_CONDITION_VIEW_PURPOSES: readonly PlantConditionViewPurpose[] = [
  'whole_plant',
  'leaf_front',
  'leaf_back',
  'stem_or_bark',
  'flower',
  'fruit',
  'symptom_close_up',
  'context_or_free_form',
];

export interface PlantConditionObservation {
  readonly kind: PlantConditionKind;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requestedAdditionalEvidence: boolean;
  /** A general care suggestion (watering, light, pruning) — empty when the model has nothing specific to add. Never chemicals, pesticides, fertilizers, or dosages, matching this port's own structural exclusion. */
  readonly careGuidanceSuggestion: string;
  /** What is visibly supporting `suggestedLabel` — empty when nothing notable is visible (matches `kind: 'other'`). */
  readonly evidenceSummary: string;
  /** Other plausible causes besides `suggestedLabel`, short labels not full sentences — empty when the model has no meaningful alternative to name. */
  readonly alternativeExplanations: readonly string[];
  readonly safetyClass: PlantConditionSafetyClass;
  /** Populated only when `requestedAdditionalEvidence` is true — which specific views would help most. Empty otherwise. */
  readonly requestedViewPurposes: readonly PlantConditionViewPurpose[];
}

export interface PlantConditionModelIdentity {
  readonly model: string;
  readonly promptTemplateVersion: number;
}

export type PlantConditionAnalysisAdapterOutcome =
  | { readonly kind: 'observation'; readonly observation: PlantConditionObservation }
  | { readonly kind: 'schemaInvalid'; readonly rawText: string | null }
  | { readonly kind: 'safetyBlocked' };

export interface PlantConditionAnalysisProviderAdapter {
  readonly identity: PlantConditionModelIdentity;

  analyzeCondition(
    request: PlantConditionAnalysisRequest,
    signal: AbortSignal,
  ): Promise<PlantConditionAnalysisAdapterOutcome>;
}
