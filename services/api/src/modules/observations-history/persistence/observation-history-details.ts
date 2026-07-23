/**
 * Batches the child-table reads `KyselyObservationRepository.listForGarden`/
 * `listForPlant` need — photos, their stub analysis results, and the "has
 * this been corrected" flag — across every fetched observation at once,
 * instead of one query per row. The same judgment `map-object-details.ts`
 * makes for `garden_object`'s category-detail tables, applied here to
 * `observation`'s child tables instead.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  ObservationHistoryEntry,
  ObservationPhotoWithAnalysis,
} from '../application/observation-repository.js';
import type { ImageAnalysisKind, ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';

interface ImageAnalysisResultRowLike {
  id: string;
  observation_photo_id: string;
  analysis_kind: string;
  suggested_label: string;
  confidence_score: string;
  requires_confirmation: boolean;
  requested_additional_evidence: boolean;
  created_at: Date;
}

function toImageAnalysisResult(row: ImageAnalysisResultRowLike): ImageAnalysisResult {
  return {
    id: row.id,
    observationPhotoId: row.observation_photo_id,
    analysisKind: row.analysis_kind as ImageAnalysisKind,
    suggestedLabel: row.suggested_label,
    confidenceScore: Number.parseFloat(row.confidence_score),
    requiresConfirmation: row.requires_confirmation,
    requestedAdditionalEvidence: row.requested_additional_evidence,
    createdAt: row.created_at,
  };
}

interface ObservationPhotoRowLike {
  id: string;
  observation_id: string;
  media_id: string;
  created_at: Date;
}

function toObservationPhoto(row: ObservationPhotoRowLike): ObservationPhoto {
  return {
    id: row.id,
    observationId: row.observation_id,
    mediaId: row.media_id,
    createdAt: row.created_at,
  };
}

export async function attachHistoryDetails(
  db: Kysely<DatabaseSchema>,
  observations: readonly Observation[],
): Promise<ObservationHistoryEntry[]> {
  if (observations.length === 0) {
    return [];
  }

  const observationIds = observations.map((observation) => observation.id);

  const correctingRows = await db
    .selectFrom('observations_history.observation')
    .select('corrects_observation_id')
    .where('corrects_observation_id', 'in', observationIds)
    .execute();
  const correctedIds = new Set(
    correctingRows
      .map((row) => row.corrects_observation_id)
      .filter((id): id is string => id !== null),
  );

  const photoRows = await db
    .selectFrom('observations_history.observation_photo')
    .selectAll()
    .where('observation_id', 'in', observationIds)
    .execute();
  const photoIds = photoRows.map((row) => row.id);

  const analysisRows =
    photoIds.length === 0
      ? []
      : await db
          .selectFrom('observations_history.image_analysis_result')
          .selectAll()
          .where('observation_photo_id', 'in', photoIds)
          .execute();

  const analysisByPhotoId = new Map<string, ImageAnalysisResult[]>();
  for (const row of analysisRows) {
    const result = toImageAnalysisResult(row);
    const existing = analysisByPhotoId.get(result.observationPhotoId);
    if (existing === undefined) {
      analysisByPhotoId.set(result.observationPhotoId, [result]);
    } else {
      existing.push(result);
    }
  }

  const photosByObservationId = new Map<string, ObservationPhotoWithAnalysis[]>();
  for (const row of photoRows) {
    const photo = toObservationPhoto(row);
    const entry: ObservationPhotoWithAnalysis = {
      photo,
      analysisResults: analysisByPhotoId.get(photo.id) ?? [],
    };
    const existing = photosByObservationId.get(photo.observationId);
    if (existing === undefined) {
      photosByObservationId.set(photo.observationId, [entry]);
    } else {
      existing.push(entry);
    }
  }

  return observations.map((observation) => ({
    observation,
    isCorrected: correctedIds.has(observation.id),
    photos: photosByObservationId.get(observation.id) ?? [],
  }));
}
