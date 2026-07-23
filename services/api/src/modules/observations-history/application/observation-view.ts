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
 * This module has no HTTP route this pass (see `public.ts` — deliberately
 * absent), so there is no `@verdery/api-contracts` schema to conform to yet.
 * This resource shape is this module's own for now, ready for that contract
 * to adopt once a route exists.
 */

import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
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
  readonly createdAt: string;
}

export interface ObservationPhotoResource {
  readonly id: string;
  readonly mediaId: string;
  readonly createdAt: string;
  readonly analysisResults: readonly ImageAnalysisResultResource[];
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
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly photos: readonly ObservationPhotoResource[];
}

function toImageAnalysisResultResource(result: ImageAnalysisResult): ImageAnalysisResultResource {
  return {
    id: result.id,
    analysisKind: result.analysisKind,
    suggestedLabel: result.suggestedLabel,
    confidenceScore: result.confidenceScore,
    requiresConfirmation: result.requiresConfirmation,
    requestedAdditionalEvidence: result.requestedAdditionalEvidence,
    createdAt: result.createdAt.toISOString(),
  };
}

function toObservationPhotoResource(entry: ObservationPhotoWithAnalysis): ObservationPhotoResource {
  return {
    id: entry.photo.id,
    mediaId: entry.photo.mediaId,
    createdAt: entry.photo.createdAt.toISOString(),
    analysisResults: entry.analysisResults.map(toImageAnalysisResultResource),
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
    observedAt: observation.observedAt.toISOString(),
    recordedAt: observation.recordedAt.toISOString(),
    photos: entry.photos.map(toObservationPhotoResource),
  };
}
