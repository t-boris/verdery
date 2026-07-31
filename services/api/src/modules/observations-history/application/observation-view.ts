/**
 * Maps a domain `ObservationHistoryEntry` to the shape a command handler or
 * list query returns.
 *
 * Application code returns this view, not the domain entity, from every
 * command and query in this module, matching gardens-mapping's own
 * `toGardenResource` convention: the idempotency store caches the literal
 * response a retried request must replay, so what a use case returns must be
 * one fixed shape, not something a later transport-layer mapping step could
 * let drift.
 *
 * This resource is built to match the `Observation` schema in
 * `packages/api-contracts/openapi.yaml` (tag `Observations`, P4-CONTRACT-01)
 * field-for-field — see `transport/observation-routes.ts`'s own header
 * comment.
 */

import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { ObservationMeasurement } from '../domain/observation-measurement.js';
import type {
  ObservationHistoryEntry,
  ObservationPhotoWithAnalysis,
} from './observation-repository.js';

export interface ImageAnalysisResultResource {
  readonly id: string;
  readonly analysisKind: string;
  readonly suggestedLabel: string;
  readonly confidenceScore: number;
  readonly requiresConfirmation: boolean;
  readonly requestedAdditionalEvidence: boolean;
  readonly evidenceSummary: string;
  readonly alternativeExplanations: readonly string[];
  readonly safetyClass: string;
  readonly requestedViewPurposes: readonly string[];
  readonly modelName: string | null;
  readonly promptVersion: number | null;
  readonly disposition: string;
  readonly dispositionSetAt: string | null;
  readonly dispositionSetByProfileId: string | null;
  readonly createdAt: string;
}

export interface ObservationPhotoResource {
  readonly id: string;
  readonly mediaId: string;
  readonly purpose: string | null;
  readonly createdAt: string;
  readonly analysisResults: readonly ImageAnalysisResultResource[];
}

export interface ObservationMeasurementResource {
  readonly id: string;
  readonly kind: string;
  readonly value: number;
  readonly unit: string;
  readonly createdAt: string;
}

export interface ObservationResource {
  readonly id: string;
  readonly gardenId: string;
  readonly plantId: string | null;
  readonly gardenObjectId: string | null;
  readonly actorType: string;
  readonly createdByProfileId: string | null;
  readonly noteText: string | null;
  readonly conditionSummary: string | null;
  readonly correctionKind: string | null;
  readonly correctsObservationId: string | null;
  readonly isCorrected: boolean;
  readonly observedPhenologicalStage: string | null;
  readonly observedSunExposure: string | null;
  readonly observedDrainage: string | null;
  readonly observedGrowingContext: string | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly photos: readonly ObservationPhotoResource[];
  readonly measurements: readonly ObservationMeasurementResource[];
}

export function toImageAnalysisResultResource(
  result: ImageAnalysisResult,
): ImageAnalysisResultResource {
  return {
    id: result.id,
    analysisKind: result.analysisKind,
    suggestedLabel: result.suggestedLabel,
    confidenceScore: result.confidenceScore,
    requiresConfirmation: result.requiresConfirmation,
    requestedAdditionalEvidence: result.requestedAdditionalEvidence,
    evidenceSummary: result.evidenceSummary,
    alternativeExplanations: result.alternativeExplanations,
    safetyClass: result.safetyClass,
    requestedViewPurposes: result.requestedViewPurposes,
    modelName: result.modelName,
    promptVersion: result.promptVersion,
    disposition: result.disposition,
    dispositionSetAt: result.dispositionSetAt?.toISOString() ?? null,
    dispositionSetByProfileId: result.dispositionSetByProfileId,
    createdAt: result.createdAt.toISOString(),
  };
}

function toObservationPhotoResource(entry: ObservationPhotoWithAnalysis): ObservationPhotoResource {
  return {
    id: entry.photo.id,
    mediaId: entry.photo.mediaId,
    purpose: entry.photo.purpose,
    createdAt: entry.photo.createdAt.toISOString(),
    analysisResults: entry.analysisResults.map(toImageAnalysisResultResource),
  };
}

function toObservationMeasurementResource(
  measurement: ObservationMeasurement,
): ObservationMeasurementResource {
  return {
    id: measurement.id,
    kind: measurement.kind,
    value: measurement.value,
    unit: measurement.unit,
    createdAt: measurement.createdAt.toISOString(),
  };
}

export function toObservationResource(entry: ObservationHistoryEntry): ObservationResource {
  const { observation } = entry;

  return {
    id: observation.id,
    gardenId: observation.gardenId,
    plantId: observation.plantId,
    gardenObjectId: observation.gardenObjectId,
    actorType: observation.actorType,
    createdByProfileId: observation.createdByProfileId,
    noteText: observation.noteText,
    conditionSummary: observation.conditionSummary,
    correctionKind: observation.correctionKind,
    correctsObservationId: observation.correctsObservationId,
    isCorrected: entry.isCorrected,
    observedPhenologicalStage: observation.observedPhenologicalStage,
    observedSunExposure: observation.observedSunExposure,
    observedDrainage: observation.observedDrainage,
    observedGrowingContext: observation.observedGrowingContext,
    observedAt: observation.observedAt.toISOString(),
    recordedAt: observation.recordedAt.toISOString(),
    photos: entry.photos.map(toObservationPhotoResource),
    measurements: entry.measurements.map(toObservationMeasurementResource),
  };
}
