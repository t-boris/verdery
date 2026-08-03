/**
 * Batches the child-table reads `KyselyObservationRepository.listForGarden`/
 * `listForPlant` need — photos, their stub analysis results, measurements,
 * and the "has this been corrected" flag — across every fetched observation
 * at once, instead of one query per row. The same judgment
 * `map-object-details.ts` makes for `garden_object`'s category-detail
 * tables, applied here to `observation`'s child tables instead.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { PlantConditionSafetyClass } from '../../integrations/public.js';
import type {
  ObservationHistoryEntry,
  ObservationPhotoWithAnalysis,
} from '../application/observation-repository.js';
import type {
  HealthSuggestionDisposition,
  ImageAnalysisKind,
  ImageAnalysisResult,
} from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type {
  ObservationMeasurement,
  ObservationMeasurementKind,
} from '../domain/observation-measurement.js';
import type {
  ObservationSymptom,
  ObservationSymptomKind,
  ObservationSymptomSeverity,
} from '../domain/observation-symptom.js';
import type { ObservationPhoto, ObservationPhotoPurpose } from '../domain/observation-photo.js';

interface ImageAnalysisResultRowLike {
  id: string;
  observation_photo_id: string;
  analysis_kind: string;
  suggested_label: string;
  confidence_score: string;
  requires_confirmation: boolean;
  requested_additional_evidence: boolean;
  model_name: string | null;
  prompt_version: number | null;
  evidence_summary: string;
  alternative_explanations: unknown;
  requested_view_purposes: unknown;
  safety_class: string;
  disposition: string;
  disposition_set_at: Date | null;
  disposition_set_by_profile_id: string | null;
  created_at: Date;
}

function toStringArray(value: unknown, columnName: string, id: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InternalError(
      'observations_history.image_analysis_result.invalid_row',
      `image_analysis_result '${id}' carries a non-array ${columnName} value.`,
    );
  }
  return value.map((entry) => String(entry));
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
    evidenceSummary: row.evidence_summary,
    alternativeExplanations: toStringArray(
      row.alternative_explanations,
      'alternative_explanations',
      row.id,
    ),
    safetyClass: row.safety_class as PlantConditionSafetyClass,
    requestedViewPurposes: toStringArray(
      row.requested_view_purposes,
      'requested_view_purposes',
      row.id,
    ) as readonly ObservationPhotoPurpose[],
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    disposition: row.disposition as HealthSuggestionDisposition,
    dispositionSetAt: row.disposition_set_at,
    dispositionSetByProfileId: row.disposition_set_by_profile_id,
    createdAt: row.created_at,
  };
}

interface ObservationPhotoRowLike {
  id: string;
  observation_id: string;
  media_id: string;
  purpose: string | null;
  created_at: Date;
}

function toObservationPhoto(row: ObservationPhotoRowLike): ObservationPhoto {
  return {
    id: row.id,
    observationId: row.observation_id,
    mediaId: row.media_id,
    purpose: row.purpose as ObservationPhotoPurpose | null,
    createdAt: row.created_at,
  };
}

interface ObservationMeasurementRowLike {
  id: string;
  observation_id: string;
  kind: string;
  value: string;
  unit: string;
  created_at: Date;
}

interface ObservationSymptomRowLike {
  id: string;
  observation_id: string;
  symptom_kind: string;
  severity: string;
  created_at: Date;
}

function toObservationSymptom(row: ObservationSymptomRowLike): ObservationSymptom {
  return {
    id: row.id,
    observationId: row.observation_id,
    kind: row.symptom_kind as ObservationSymptomKind,
    severity: row.severity as ObservationSymptomSeverity,
    createdAt: row.created_at,
  };
}

function toObservationMeasurement(row: ObservationMeasurementRowLike): ObservationMeasurement {
  return {
    id: row.id,
    observationId: row.observation_id,
    kind: row.kind as ObservationMeasurementKind,
    // `numeric(10,2)` — see persistence/schema.ts's doc comment on
    // ObservationMeasurementRow.
    value: Number.parseFloat(row.value),
    unit: row.unit,
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

  const measurementRows = await db
    .selectFrom('observations_history.observation_measurement')
    .selectAll()
    .where('observation_id', 'in', observationIds)
    .execute();

  const measurementsByObservationId = new Map<string, ObservationMeasurement[]>();
  for (const row of measurementRows) {
    const measurement = toObservationMeasurement(row);
    const existing = measurementsByObservationId.get(measurement.observationId);
    if (existing === undefined) {
      measurementsByObservationId.set(measurement.observationId, [measurement]);
    } else {
      existing.push(measurement);
    }
  }

  const symptomRows = await db
    .selectFrom('observations_history.observation_symptom')
    .selectAll()
    .where('observation_id', 'in', observationIds)
    .execute();

  const symptomsByObservationId = new Map<string, ObservationSymptom[]>();
  for (const row of symptomRows) {
    const symptom = toObservationSymptom(row);
    const existing = symptomsByObservationId.get(symptom.observationId);
    if (existing === undefined) {
      symptomsByObservationId.set(symptom.observationId, [symptom]);
    } else {
      existing.push(symptom);
    }
  }

  return observations.map((observation) => ({
    observation,
    isCorrected: correctedIds.has(observation.id),
    photos: photosByObservationId.get(observation.id) ?? [],
    measurements: measurementsByObservationId.get(observation.id) ?? [],
    symptoms: symptomsByObservationId.get(observation.id) ?? [],
  }));
}
