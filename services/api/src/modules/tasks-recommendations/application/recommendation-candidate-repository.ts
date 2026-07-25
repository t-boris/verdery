/**
 * Port for `tasks_recommendations.recommendation_candidate` and its
 * child evidence/priority-factor rows — the persistence surface the rule
 * engine produces through and reads its own prior output from.
 *
 * `insertAggregate` writes a candidate WITH its evidence and factors in
 * one call because the pieces are one atomic fact: the migration's
 * deferred composite FK rejects a candidate whose evidence is missing at
 * COMMIT, so no caller may ever hold an API that inserts them separately.
 *
 * Read methods return `StoredCandidateWithRule` — the candidate joined
 * with its rule version's identity — because every suppression and
 * supersession decision compares by `(ruleKey, ruleVersion)`, and making
 * each caller re-join would scatter that invariant.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  RecommendationCandidate,
  RecommendationCandidateAggregate,
} from '../domain/recommendation-candidate.js';
import type { RecommendationEvidence } from '../domain/recommendation-evidence.js';
import type { RecommendationFeedback } from '../domain/recommendation-feedback.js';
import type { RecommendationPriorityFactor } from '../domain/recommendation-priority.js';

export interface StoredCandidateWithRule {
  readonly candidate: RecommendationCandidate;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  /**
   * The horizon from the candidate's latest `postponed` feedback row —
   * populated ONLY by `listLatestPerRuleAndTarget` (the engine's
   * postponed-prior re-surfacing input, P7-BE-01); every other read
   * returns `null` because no caller consults it there and the extra join
   * would be dead weight.
   */
  readonly postponedUntil: Date | null;
}

export interface RecommendationCandidateRepository {
  /**
   * Serializes concurrent evaluations of one garden for the duration of
   * the surrounding transaction (a transaction-scoped advisory lock in
   * the real implementation). Without it, two simultaneous evaluations
   * could each observe no live candidate and both insert one — the
   * duplicate section 17 measures against. Called first inside
   * `EvaluateGardenRecommendations`' transaction.
   */
  lockGardenForEvaluation(gardenId: Uuid): Promise<void>;

  /** Inserts the candidate, its evidence rows, and its priority-factor rows together. */
  insertAggregate(
    aggregate: RecommendationCandidateAggregate,
    factors: readonly RecommendationPriorityFactor[],
  ): Promise<void>;

  /**
   * Writes the candidate's new state guarded by `expectedRevision`,
   * returning `false` on a revision mismatch without throwing — the same
   * contract `TaskRepository.update` follows.
   */
  update(candidate: RecommendationCandidate, expectedRevision: number): Promise<boolean>;

  /** Every candidate of the garden still in a live (`generated`/`eligible`/`presented`) state. */
  listLiveForGarden(gardenId: Uuid): Promise<readonly StoredCandidateWithRule[]>;

  /** The most recently created candidate per (rule key, target) in the garden, regardless of state — the recurrence-interval baseline. */
  listLatestPerRuleAndTarget(gardenId: Uuid): Promise<readonly StoredCandidateWithRule[]>;

  /** The named candidates with their rule identities — how open tasks' `origin_recommendation_id` values resolve to rule keys, and how the Today commands load their target candidate. Empty input returns empty. */
  findWithRuleByIds(candidateIds: readonly Uuid[]): Promise<readonly StoredCandidateWithRule[]>;

  /**
   * The Today query's raw set (P7-BE-01): every candidate of the garden in
   * `eligible`/`presented` whose validity window covers `now` (a `null`
   * bound is unbounded on that side). Ordering across candidates is the
   * caller's — priority is re-derived in the application from the stored
   * factor rows, deliberately not in SQL.
   */
  listPresentableForGarden(gardenId: Uuid, now: Date): Promise<readonly StoredCandidateWithRule[]>;

  /** Every stored priority-factor row of the named candidates — the Today ordering's input. Empty input returns empty. */
  listFactorsForCandidates(
    candidateIds: readonly Uuid[],
  ): Promise<readonly RecommendationPriorityFactor[]>;

  /** Every stored evidence row of the named candidates — FR-24's "Evidence used", returned structured. Empty input returns empty. */
  listEvidenceForCandidates(
    candidateIds: readonly Uuid[],
  ): Promise<readonly RecommendationEvidence[]>;

  /** Appends one immutable feedback row — the append-only trail's single write path (P7-BE-01's commands). */
  appendFeedback(feedback: RecommendationFeedback): Promise<void>;

  /** The candidate's feedback trail, newest first — the outcome-history read. */
  listFeedbackForCandidate(candidateId: Uuid): Promise<readonly RecommendationFeedback[]>;

  /**
   * Up to `limit` distinct garden ids (ascending, for determinism) that
   * still hold a live candidate whose `window_end` is at or before `now` —
   * the expiry sweep's candidate selection (P7-ASYNC-01). Expiring drains
   * the set, so successive bounded runs always make progress. Deliberately
   * NOT filtered by garden lifecycle or plant inventory: a stale live
   * candidate must be closable wherever it lingers (section 17 freshness),
   * archived gardens included.
   */
  listGardenIdsWithExpirableCandidates(now: Date, limit: number): Promise<readonly Uuid[]>;
}
