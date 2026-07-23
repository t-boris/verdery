import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { ImageAnalysisResultRepository } from '../application/image-analysis-result-repository.js';
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';

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
        created_at: result.createdAt,
      })
      .execute();
  }
}
