/**
 * The Today query (P7-BE-01): the small prioritized set of actionable
 * recommendations for one garden — FR-3's "limited set of prioritized
 * actions", each with reason, urgency, uncertainty, and the controls the
 * feedback commands implement.
 *
 * WHAT IT RETURNS: candidates in `eligible`/`presented` whose validity
 * window covers now, ordered by priority re-derived from the STORED factor
 * rows — the clamped-to-[0,100] sum of `{ contribution, basis }`
 * contributions, the same `aggregatePriorityContributions` the engine used
 * to compute the score at generation ("The application stores the factors
 * needed to explain rank", section 7 — the stored rows alone reproduce the
 * rank, and the shared function is what keeps write-side and read-side
 * scores provably identical). Ties break by sooner `windowEnd` first
 * (`null` last — an unbounded window has no deadline pressure), then by id
 * for stability. The set is capped (`limit`, bounded below) — FR-3 asks
 * for a LIMITED set, so this is a cap on a prioritized selection, not
 * cursor pagination over a browsable collection.
 *
 * PRESENTED-TRANSITION DECISION — the QUERY transitions `eligible ->
 * presented` on first inclusion (read-triggers-write), not a separate
 * acknowledge command, because: (1) presentation is a server-observable
 * fact — the server returned the candidate in a Today response, which IS
 * section 6's "presented"; (2) an acknowledge command would leave the
 * lifecycle hostage to client cooperation — an uncooperative client would
 * strand candidates in `eligible` forever, and the feedback commands'
 * `presented`-state precondition (pinned by the migration's `presented_at`
 * CHECK) would then reject every action; (3) the transition is naturally
 * idempotent — only the FIRST inclusion writes; later reads see
 * `presented` and write nothing — so the GET stays safely retryable
 * without an idempotency key. Only candidates actually INCLUDED in the
 * capped response are marked; a candidate beyond the cap was not shown.
 *
 * RACE HANDLING: the whole read-mark-return runs in one transaction under
 * the same per-garden advisory lock the evaluation and expiry sweeps take
 * (`lockGardenForEvaluation`), so a presentation cannot interleave with an
 * evaluation superseding — or a sweep expiring — the same candidate; a
 * concurrent Today request serializes and finds the row already
 * `presented`. The feedback commands stay non-locking (they touch only
 * `presented` rows, which this query never writes), so a revision-guard
 * failure here means a foreign writer — refused loudly, the
 * `evaluate-garden-recommendations.ts` posture.
 *
 * AUTHORIZATION: `viewGarden`, like every garden read — the presented mark
 * is server bookkeeping riding the read, not a member content edit.
 *
 * AI EMBELLISHMENT SERVING (P7-AI-01): when — and only when — the
 * kill-switch is on, the returned items additionally carry any ACCEPTED
 * stored embellishment (`embellishedExplanation` +
 * `explanationSource: 'ai_embellished'`), read from the verdict rows the
 * sweep's embellishment phase wrote. This query NEVER calls the
 * provider: serving is a read of already-validated stored text, so Today
 * latency is untouched by Vertex (section 16's latency budget). With
 * the switch off the verdict table is not even read and every item is
 * `explanationSource: 'deterministic'` — flipping the switch back off
 * restores baseline behavior exactly, reads included (the work
 * package's rollback evidence). `explanation` itself is ALWAYS the
 * stored deterministic text.
 *
 * A candidate whose stored (ruleKey, ruleVersion) the catalog no longer
 * ships cannot resolve its `actionTitle` and fails loudly: the catalog's
 * own contract keeps every shipped version forever, so absence is a
 * release defect (a rolled-back deploy serving newer-version candidates —
 * the next evaluation sweep supersedes them as stale).
 *
 * Source: architecture/recommendations-and-ai.md, sections "6. Candidate
 * Lifecycle" and "7. Priority"; technical-specification.md, section
 * "FR-3: Today View"; implementation-plan.md work package P7-BE-01.
 */

import { InternalError, ConflictError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { AiExplanationLocale } from '../../integrations/public.js';
import { presentRecommendationCandidate } from '../domain/recommendation-lifecycle.js';
import type { RecommendationPriorityFactor } from '../domain/recommendation-priority.js';
import { derivePriorityScoreFromStoredFactors } from '../domain/recommendation-priority.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import type { StoredCandidateWithRule } from './recommendation-candidate-repository.js';
import type { TodayRecommendationResource, TodayViewResource } from './recommendation-view.js';
import {
  toEvidenceResource,
  toPriorityFactorResource,
  toRecommendationResource,
} from './recommendation-view.js';
import type {
  TasksRecommendationsTransactionContext,
  TasksRecommendationsUnitOfWork,
} from './tasks-recommendations-unit-of-work.js';

/** FR-3 names no number; a phone-screen "limited set" default, documented in the contract. */
export const TODAY_DEFAULT_LIMIT = 10;
export const TODAY_MAX_LIMIT = 25;

interface RankedCandidate {
  readonly stored: StoredCandidateWithRule;
  readonly priorityScore: number;
  readonly factors: readonly RecommendationPriorityFactor[];
}

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  if (a.priorityScore !== b.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }
  const aEnd = a.stored.candidate.windowEnd;
  const bEnd = b.stored.candidate.windowEnd;
  if (aEnd !== null || bEnd !== null) {
    if (aEnd === null) {
      return 1;
    }
    if (bEnd === null) {
      return -1;
    }
    if (aEnd.getTime() !== bEnd.getTime()) {
      return aEnd.getTime() - bEnd.getTime();
    }
  }
  return a.stored.candidate.id.localeCompare(b.stored.candidate.id);
}

/** How the Today view serves AI embellishments — `enabled: false` (the kill-switch off) means the verdict table is never read. */
export interface AiExplanationServingPolicy {
  readonly enabled: boolean;
  readonly locale: AiExplanationLocale;
}

export class GetTodayView {
  constructor(
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly catalog: RuleCatalog,
    private readonly aiServing: AiExplanationServingPolicy,
    private readonly clock: Clock,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid, limit: number): Promise<TodayViewResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    return this.unitOfWork.run(async (context) => {
      await context.recommendationCandidates.lockGardenForEvaluation(gardenId);
      const now = this.clock.now();

      const presentable = await context.recommendationCandidates.listPresentableForGarden(
        gardenId,
        now,
      );
      const factorRows = await context.recommendationCandidates.listFactorsForCandidates(
        presentable.map((stored) => stored.candidate.id),
      );
      const factorsByCandidate = new Map<Uuid, RecommendationPriorityFactor[]>();
      for (const factor of factorRows) {
        const list = factorsByCandidate.get(factor.candidateId) ?? [];
        list.push(factor);
        factorsByCandidate.set(factor.candidateId, list);
      }

      const ranked = presentable
        .map((stored): RankedCandidate => {
          const factors = factorsByCandidate.get(stored.candidate.id) ?? [];
          return {
            stored,
            factors,
            priorityScore: derivePriorityScoreFromStoredFactors(stored.candidate.id, factors),
          };
        })
        .sort(compareRanked)
        .slice(0, limit);

      const evidenceRows = await context.recommendationCandidates.listEvidenceForCandidates(
        ranked.map((entry) => entry.stored.candidate.id),
      );

      // Kill-switch off = the verdict table is not read at all — see the
      // header's serving comment; the disabled read path is the baseline
      // read path, exactly.
      const embellishmentByCandidate = new Map<Uuid, string>();
      if (this.aiServing.enabled) {
        const acceptedRecords = await context.aiExplanations.listAcceptedForCandidates(
          ranked.map((entry) => entry.stored.candidate.id),
          this.aiServing.locale,
        );
        for (const record of acceptedRecords) {
          if (record.generatedText !== null) {
            embellishmentByCandidate.set(record.candidateId, record.generatedText);
          }
        }
      }

      const items: TodayRecommendationResource[] = [];
      for (const entry of ranked) {
        let { candidate } = entry.stored;
        if (candidate.state === 'eligible') {
          const presented = presentRecommendationCandidate(candidate, now);
          const written = await context.recommendationCandidates.update(
            presented,
            candidate.revision,
          );
          if (!written) {
            // Every candidate-state writer except the feedback commands
            // holds the advisory lock, and feedback never touches an
            // `eligible` row — a lost race here is a foreign writer, a
            // defect surfaced loudly (the evaluation use case's posture).
            throw new ConflictError(
              'tasks_recommendations.recommendation.presentation_conflict',
              `Candidate '${candidate.id}' changed concurrently while being presented.`,
            );
          }
          candidate = presented;
        }

        const definition = this.catalog.find(entry.stored.ruleKey, entry.stored.ruleVersion);
        if (definition === null) {
          throw new InternalError(
            'tasks_recommendations.recommendation.rule_version_unshipped',
            `Candidate '${candidate.id}' pins rule '${entry.stored.ruleKey}' v${String(entry.stored.ruleVersion)}, which this build's catalog does not ship.`,
          );
        }

        const embellishedExplanation = embellishmentByCandidate.get(candidate.id) ?? null;
        items.push({
          ...toRecommendationResource(candidate, entry.stored.ruleKey, entry.stored.ruleVersion),
          actionTitle: definition.actionTitle,
          explanationSource: embellishedExplanation === null ? 'deterministic' : 'ai_embellished',
          embellishedExplanation,
          priorityScore: entry.priorityScore,
          priorityFactors: entry.factors.map(toPriorityFactorResource),
          evidence: evidenceRows
            .filter((evidence) => evidence.candidateId === candidate.id)
            .map(toEvidenceResource),
          targetDisplayName: await this.resolveTargetDisplayName(context, candidate.targetPlantId),
        });
      }

      return { gardenId, generatedAt: now.toISOString(), items };
    });
  }

  /** Plant targets resolve to the plant's CURRENT display name; garden and area targets return `null` — see `TodayRecommendationResource.targetDisplayName`. */
  private async resolveTargetDisplayName(
    context: TasksRecommendationsTransactionContext,
    targetPlantId: Uuid | null,
  ): Promise<string | null> {
    if (targetPlantId === null) {
      return null;
    }
    const plant = await context.plants.findById(targetPlantId);
    return plant?.displayName ?? null;
  }
}
