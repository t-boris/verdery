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
 * `plant-species-identification-provider.ts`'s own boundary: toxicity,
 * edibility, and any chemical-application guidance. The request and
 * response shapes below have no field for them, and the adapter's system
 * instruction refuses to discuss them even if a photo or a future prompt
 * change tried to elicit it.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md;
 * architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md.
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

export interface PlantConditionObservation {
  readonly kind: PlantConditionKind;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requestedAdditionalEvidence: boolean;
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
