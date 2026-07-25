/**
 * Port for `tasks_recommendations.recommendation_ai_explanation`
 * (P7-AI-01) — the append-only per-(candidate, locale) verdict rows the
 * embellishment use case writes and the Today surface reads.
 *
 * `insertIfAbsent` is the single write path: rows are verdicts about one
 * generation attempt, unique per (candidate, locale), inserted
 * `ON CONFLICT DO NOTHING` so a duplicated or raced run converges to one
 * row and reports the loss instead of erroring — the same
 * duplicate-safety posture every sweep write in this module takes.
 *
 * `listEmbellishableCandidateIds` is the sweep phase's selection: live
 * presentable candidates (the states/window Today reads) that carry a
 * stored deterministic explanation but no verdict row yet for the
 * locale. Because TRANSIENT provider failures write no row (section 14:
 * "Calls retry only for safe transient outcomes"), a failed candidate
 * naturally re-enters this selection next run, while every durable
 * verdict — accepted or rejected — leaves it permanently.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AiExplanationLocale } from '../../integrations/public.js';
import type { AiExplanationRecord } from '../domain/ai-explanation.js';

export interface AiExplanationRecordRepository {
  /** Inserts the record unless one already exists for its (candidate, locale); returns whether this call inserted. */
  insertIfAbsent(record: AiExplanationRecord): Promise<boolean>;

  /** The ACCEPTED records of the named candidates for one locale — the Today serving read. Empty input returns empty. */
  listAcceptedForCandidates(
    candidateIds: readonly Uuid[],
    locale: AiExplanationLocale,
  ): Promise<readonly AiExplanationRecord[]>;

  /**
   * Up to `limit` candidate ids (ascending, for determinism) in
   * `eligible`/`presented` with a validity window covering `now`, a
   * non-null stored explanation, and no verdict row for `locale` — the
   * embellishment phase's bounded, self-draining selection.
   */
  listEmbellishableCandidateIds(
    locale: AiExplanationLocale,
    now: Date,
    limit: number,
  ): Promise<readonly Uuid[]>;
}
