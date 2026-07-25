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
import type { RecommendationPriorityFactor } from '../domain/recommendation-priority.js';

export interface StoredCandidateWithRule {
  readonly candidate: RecommendationCandidate;
  readonly ruleKey: string;
  readonly ruleVersion: number;
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

  /** The named candidates with their rule identities — how open tasks' `origin_recommendation_id` values resolve to rule keys. Empty input returns empty. */
  findWithRuleByIds(candidateIds: readonly Uuid[]): Promise<readonly StoredCandidateWithRule[]>;

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
