/**
 * `RunRecommendationEvaluationSweep` (P7-ASYNC-01): the scheduled pass that
 * (1) evaluates the launch rule catalog for every eligible garden through
 * `EvaluateGardenRecommendations`, and (2) closes the candidate-expiry gap
 * P7-RULE-01 deferred here — live candidates whose validity window passed
 * without the rule re-firing transition to `expired` through the
 * `expireRecommendationCandidate` edge P7-DATA-01 shipped for exactly this
 * sweep.
 *
 * WHERE THIS RUNS, AND WHY: in `services/api`, triggered by an authenticated
 * internal endpoint the worker's own interval scheduler calls — the
 * P6-RET-01 retention-sweep shape, same privilege reasoning
 * (`run-media-retention-sweep.ts`): `verdery_worker` has no access to any
 * recommendation, garden, or plant table, and the worker contributes only
 * its interval loop and verified OIDC identity.
 *
 * BOUNDING — full drain in bounded pages, not a per-run cap, deliberately:
 * the retention sweep caps 25 candidates per run because each one fans out
 * to a deletion workflow; one garden's evaluation is a bounded handful of
 * reads and at most a few candidate inserts, and — decisively — evaluation
 * leaves NO durable ordering key behind when it suppresses everything, so a
 * per-run cap over a stable ordering would starve every garden beyond the
 * cap forever. Draining the whole eligible set in id-ordered keyset pages
 * (page size below) keeps each transaction small while guaranteeing every
 * garden is visited every run. When garden count outgrows a single
 * in-request pass, asynchronous-processing.md section 7 already names Cloud
 * Run Jobs for "bulk recommendation computation" — that migration is
 * recorded in deferred-capabilities.md, not pre-built.
 *
 * DUPLICATE SAFETY, layer by layer (the work package's acceptance
 * evidence):
 * - a duplicate or retried trigger re-evaluates over unchanged facts and
 *   writes nothing — `EvaluateGardenRecommendations` is idempotent per
 *   window by construction (`liveCandidateExists` suppression);
 * - concurrent invocations serialize per garden on the transaction-scoped
 *   advisory lock inside the evaluation transaction — the second writer
 *   sees the first's committed candidates and suppresses;
 * - the expiry phase takes the SAME per-garden advisory lock, so expiry can
 *   never interleave with an in-flight evaluation deciding to supersede the
 *   same candidate (`evaluate-garden-recommendations.ts` treats a mid-
 *   transaction revision change as a defect — the shared lock is what makes
 *   that reasoning hold).
 *
 * ORDER WITHIN A RUN — evaluate first, expire second, deliberately:
 * supersession is the preferred close for a stale candidate whose rule
 * still fires (it links history and is recurrence-exempt — "replacing is
 * not repeating"); expiry mops up only what evaluation left live with a
 * passed window. Expiring first would convert would-be supersessions into
 * recurrence-suppressed re-fires — a behavior change, not a cleanup.
 *
 * A supersession revision conflict (`ConflictError` — some non-evaluation
 * writer touched a candidate mid-flight) is counted as a lost race and the
 * sweep moves on: the next run retries, and one contended garden must not
 * poison the rest of the batch (asynchronous-processing.md section 12).
 * Unexpected errors still propagate and fail the run loudly — the retention
 * sweep's own posture.
 */

import { ConflictError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { expireRecommendationCandidate } from '../domain/recommendation-lifecycle.js';
import type {
  EvaluateGardenRecommendationsInput,
  EvaluateGardenRecommendationsResult,
} from './evaluate-garden-recommendations.js';
import type { EvaluationGardenSource } from './evaluation-garden-source.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';

/**
 * Gardens per keyset page — a paging mechanic bounding one transaction-free
 * listing read, not a per-run work cap (see the header comment). 25 matches
 * the sibling sweeps' batch shape.
 */
export const EVALUATION_SWEEP_PAGE_SIZE = 25;

/**
 * Per-run ceiling on gardens the EXPIRY phase processes. Unlike evaluation,
 * expiry has natural drainage (an expired candidate leaves the selection),
 * so a bounded batch with the hourly-order cadence converges — the
 * `RETENTION_SWEEP_BATCH_LIMIT` posture, same reasoned 25.
 */
export const EXPIRY_SWEEP_GARDEN_LIMIT = 25;

/** The narrow slice of `EvaluateGardenRecommendations` this sweep drives — structural, so tests fake it without the full constructor. */
export interface GardenRecommendationEvaluator {
  execute(input: EvaluateGardenRecommendationsInput): Promise<EvaluateGardenRecommendationsResult>;
}

export interface RecommendationEvaluationSweepResult {
  /** Eligible gardens this run evaluated (lost-race gardens excluded). */
  readonly gardensEvaluated: number;
  /** Candidates created across all evaluations. */
  readonly candidatesCreated: number;
  /** Prior candidates superseded by this run's created candidates. */
  readonly candidatesSuperseded: number;
  /** Live past-window candidates the expiry phase transitioned to `expired`. */
  readonly candidatesExpired: number;
  /** Gardens skipped after a concurrent-writer revision conflict — retried next run. */
  readonly lostRaces: number;
}

export class RunRecommendationEvaluationSweep {
  constructor(
    private readonly gardens: EvaluationGardenSource,
    private readonly evaluateGardenRecommendations: GardenRecommendationEvaluator,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<RecommendationEvaluationSweepResult> {
    let gardensEvaluated = 0;
    let candidatesCreated = 0;
    let candidatesSuperseded = 0;
    let lostRaces = 0;

    let afterGardenId: Uuid | null = null;
    for (;;) {
      const page = await this.gardens.listEligibleGardenIds(
        afterGardenId,
        EVALUATION_SWEEP_PAGE_SIZE,
      );
      if (page.length === 0) {
        break;
      }

      for (const gardenId of page) {
        try {
          const result = await this.evaluateGardenRecommendations.execute({ gardenId });
          gardensEvaluated += 1;
          candidatesCreated += result.createdCandidates.length;
          candidatesSuperseded += result.createdCandidates.filter(
            (candidate) => candidate.supersededCandidateId !== null,
          ).length;
        } catch (error) {
          if (error instanceof ConflictError) {
            lostRaces += 1;
            continue;
          }
          throw error;
        }
      }

      afterGardenId = page[page.length - 1] ?? null;
      if (page.length < EVALUATION_SWEEP_PAGE_SIZE) {
        break;
      }
    }

    const expiry = await this.expirePassedWindowCandidates();

    return {
      gardensEvaluated,
      candidatesCreated,
      candidatesSuperseded,
      candidatesExpired: expiry.expired,
      lostRaces: lostRaces + expiry.lostRaces,
    };
  }

  /** See the header comment: runs AFTER evaluation so supersession stays the preferred close. */
  private async expirePassedWindowCandidates(): Promise<{ expired: number; lostRaces: number }> {
    const now = this.clock.now();
    const gardenIds = await this.unitOfWork.run((context) =>
      context.recommendationCandidates.listGardenIdsWithExpirableCandidates(
        now,
        EXPIRY_SWEEP_GARDEN_LIMIT,
      ),
    );

    let expired = 0;
    let lostRaces = 0;

    for (const gardenId of gardenIds) {
      const outcome = await this.unitOfWork.run(async (context) => {
        // The SAME advisory lock evaluation takes: expiry and evaluation of
        // one garden serialize, so live-candidate reads below are current
        // for the whole transaction.
        await context.recommendationCandidates.lockGardenForEvaluation(gardenId);
        const live = await context.recommendationCandidates.listLiveForGarden(gardenId);
        const expiredAt = this.clock.now();

        let gardenExpired = 0;
        let gardenLostRaces = 0;
        for (const stored of live) {
          const { candidate } = stored;
          if (candidate.windowEnd === null || candidate.windowEnd.getTime() > now.getTime()) {
            continue;
          }
          const transitioned = expireRecommendationCandidate(candidate, expiredAt);
          const written = await context.recommendationCandidates.update(
            transitioned,
            candidate.revision,
          );
          if (written) {
            gardenExpired += 1;
          } else {
            // Unreachable under the advisory lock; counted, not hidden, if
            // a non-locking writer ever appears.
            gardenLostRaces += 1;
          }
        }
        return { gardenExpired, gardenLostRaces };
      });
      expired += outcome.gardenExpired;
      lostRaces += outcome.gardenLostRaces;
    }

    return { expired, lostRaces };
  }
}
