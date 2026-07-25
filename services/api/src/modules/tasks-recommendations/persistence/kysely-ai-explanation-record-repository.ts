/**
 * Kysely implementation of `AiExplanationRecordRepository` over
 * `tasks_recommendations.recommendation_ai_explanation` (P7-AI-01).
 *
 * `insertIfAbsent` relies on the migration's UNIQUE (candidate_id,
 * locale) index with `ON CONFLICT DO NOTHING` — the same
 * converge-not-error race posture `MapPlantTaxonomy` documents for its
 * live-mapping index.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AiExplanationLocale } from '../../integrations/public.js';
import type { AiExplanationRecordRepository } from '../application/ai-explanation-record-repository.js';
import type {
  AiExplanationRecord,
  AiExplanationValidationOutcome,
} from '../domain/ai-explanation.js';
import { AI_EXPLANATION_LOCALES } from '../domain/ai-explanation.js';

interface AiExplanationRowLike {
  id: string;
  candidate_id: string;
  locale: string;
  provider_key: string;
  model: string;
  prompt_template_version: number;
  packet_fact_keys: unknown;
  generated_text: string | null;
  validation_outcome: string;
  created_at: Date;
}

function toRecord(row: AiExplanationRowLike): AiExplanationRecord {
  const locale = row.locale as AiExplanationLocale;
  if (!AI_EXPLANATION_LOCALES.includes(locale)) {
    // Only this module writes these rows through the domain constructor —
    // an unknown stored locale is a defect, refused loudly.
    throw new InternalError(
      'tasks_recommendations.ai_explanation.stored_locale_unknown',
      `AI explanation record '${row.id}' carries unknown locale '${row.locale}'.`,
    );
  }
  if (!Array.isArray(row.packet_fact_keys)) {
    throw new InternalError(
      'tasks_recommendations.ai_explanation.stored_packet_malformed',
      `AI explanation record '${row.id}' carries a non-array packet_fact_keys value.`,
    );
  }
  return {
    id: row.id,
    candidateId: row.candidate_id,
    locale,
    providerKey: row.provider_key,
    model: row.model,
    promptTemplateVersion: row.prompt_template_version,
    packetFactKeys: row.packet_fact_keys.map((key) => String(key)),
    generatedText: row.generated_text,
    validationOutcome: row.validation_outcome as AiExplanationValidationOutcome,
    createdAt: row.created_at,
  };
}

export class KyselyAiExplanationRecordRepository implements AiExplanationRecordRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insertIfAbsent(record: AiExplanationRecord): Promise<boolean> {
    const result = await this.db
      .insertInto('tasks_recommendations.recommendation_ai_explanation')
      .values({
        id: record.id,
        candidate_id: record.candidateId,
        locale: record.locale,
        provider_key: record.providerKey,
        model: record.model,
        prompt_template_version: record.promptTemplateVersion,
        packet_fact_keys: JSON.stringify(record.packetFactKeys),
        generated_text: record.generatedText,
        validation_outcome: record.validationOutcome,
        created_at: record.createdAt,
      })
      .onConflict((oc) => oc.columns(['candidate_id', 'locale']).doNothing())
      .executeTakeFirst();
    return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
  }

  async listAcceptedForCandidates(
    candidateIds: readonly Uuid[],
    locale: AiExplanationLocale,
  ): Promise<readonly AiExplanationRecord[]> {
    if (candidateIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .selectFrom('tasks_recommendations.recommendation_ai_explanation')
      .selectAll()
      .where('candidate_id', 'in', [...candidateIds])
      .where('locale', '=', locale)
      .where('validation_outcome', '=', 'accepted')
      .orderBy('id')
      .execute();
    return rows.map(toRecord);
  }

  async listEmbellishableCandidateIds(
    locale: AiExplanationLocale,
    now: Date,
    limit: number,
  ): Promise<readonly Uuid[]> {
    const rows = await this.db
      .selectFrom('tasks_recommendations.recommendation_candidate as candidate')
      .select('candidate.id')
      .where('candidate.state', 'in', ['eligible', 'presented'])
      .where('candidate.explanation', 'is not', null)
      .where((eb) =>
        eb.or([eb('candidate.window_start', 'is', null), eb('candidate.window_start', '<=', now)]),
      )
      .where((eb) =>
        eb.or([eb('candidate.window_end', 'is', null), eb('candidate.window_end', '>=', now)]),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('tasks_recommendations.recommendation_ai_explanation as record')
              .select('record.id')
              .whereRef('record.candidate_id', '=', 'candidate.id')
              .where('record.locale', '=', locale),
          ),
        ),
      )
      .orderBy('candidate.id')
      .limit(limit)
      .execute();
    return rows.map((row) => row.id);
  }
}
