import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ImageAnalysisResultRepository,
  ImageAnalysisResultWithGardenContext,
} from '../application/image-analysis-result-repository.js';
import type {
  HealthSuggestionDisposition,
  ImageAnalysisKind,
  ImageAnalysisResult,
} from '../domain/image-analysis-result.js';
import type { ObservationPhotoPurpose } from '../domain/observation-photo.js';
import type { PlantConditionSafetyClass } from '../../integrations/public.js';

function toStringArray(value: unknown, columnName: string, id: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InternalError(
      'observations_history.image_analysis_result.invalid_row',
      `image_analysis_result '${id}' carries a non-array ${columnName} value.`,
    );
  }
  return value.map((entry) => String(entry));
}

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

function toImageAnalysisResult(row: ImageAnalysisResultRowLike): ImageAnalysisResult {
  return {
    id: row.id,
    observationPhotoId: row.observation_photo_id,
    analysisKind: row.analysis_kind as ImageAnalysisKind,
    suggestedLabel: row.suggested_label,
    // `numeric(4,3)` — see persistence/schema.ts's doc comment.
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

export class KyselyImageAnalysisResultRepository implements ImageAnalysisResultRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(result: ImageAnalysisResult): Promise<void> {
    await this.db
      .insertInto('observations_history.image_analysis_result')
      .values({
        id: result.id,
        observation_photo_id: result.observationPhotoId,
        analysis_kind: result.analysisKind,
        suggested_label: result.suggestedLabel,
        // `numeric(4,3)` — see persistence/schema.ts's doc comment on
        // ImageAnalysisResultRow for why this is stringified explicitly here.
        confidence_score: String(result.confidenceScore),
        // Always `true` (`result.requiresConfirmation` is hardcoded `true` in
        // `createImageAnalysisResult`, never a caller-supplied value) — this
        // module never writes `false` from the analysis stub.
        requires_confirmation: result.requiresConfirmation,
        requested_additional_evidence: result.requestedAdditionalEvidence,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        evidence_summary: result.evidenceSummary,
        alternative_explanations: JSON.stringify(result.alternativeExplanations),
        requested_view_purposes: JSON.stringify(result.requestedViewPurposes),
        safety_class: result.safetyClass,
        disposition: result.disposition,
        disposition_set_at: result.dispositionSetAt,
        disposition_set_by_profile_id: result.dispositionSetByProfileId,
        created_at: result.createdAt,
      })
      .execute();
  }

  async getWithGardenContext(id: Uuid): Promise<ImageAnalysisResultWithGardenContext | null> {
    const row = await this.db
      .selectFrom('observations_history.image_analysis_result')
      .innerJoin(
        'observations_history.observation_photo',
        'observations_history.observation_photo.id',
        'observations_history.image_analysis_result.observation_photo_id',
      )
      .innerJoin(
        'observations_history.observation',
        'observations_history.observation.id',
        'observations_history.observation_photo.observation_id',
      )
      .select([
        'observations_history.image_analysis_result.id as id',
        'observations_history.image_analysis_result.observation_photo_id as observation_photo_id',
        'observations_history.image_analysis_result.analysis_kind as analysis_kind',
        'observations_history.image_analysis_result.suggested_label as suggested_label',
        'observations_history.image_analysis_result.confidence_score as confidence_score',
        'observations_history.image_analysis_result.requires_confirmation as requires_confirmation',
        'observations_history.image_analysis_result.requested_additional_evidence as requested_additional_evidence',
        'observations_history.image_analysis_result.model_name as model_name',
        'observations_history.image_analysis_result.prompt_version as prompt_version',
        'observations_history.image_analysis_result.evidence_summary as evidence_summary',
        'observations_history.image_analysis_result.alternative_explanations as alternative_explanations',
        'observations_history.image_analysis_result.requested_view_purposes as requested_view_purposes',
        'observations_history.image_analysis_result.safety_class as safety_class',
        'observations_history.image_analysis_result.disposition as disposition',
        'observations_history.image_analysis_result.disposition_set_at as disposition_set_at',
        'observations_history.image_analysis_result.disposition_set_by_profile_id as disposition_set_by_profile_id',
        'observations_history.image_analysis_result.created_at as created_at',
        'observations_history.observation.garden_id as garden_id',
      ])
      .where('observations_history.image_analysis_result.id', '=', id)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }
    return { result: toImageAnalysisResult(row), gardenId: row.garden_id };
  }

  async update(result: ImageAnalysisResult): Promise<void> {
    await this.db
      .updateTable('observations_history.image_analysis_result')
      .set({
        disposition: result.disposition,
        disposition_set_at: result.dispositionSetAt,
        disposition_set_by_profile_id: result.dispositionSetByProfileId,
      })
      .where('id', '=', result.id)
      .execute();
  }
}
