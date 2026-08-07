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
 * DUE GARDENS, NOT EVERY GARDEN (and why the interval could then shrink):
 * this sweep used to drain every eligible garden on every run, which made
 * the interval a direct trade between responsiveness and cost — it sat at
 * six hours, so adding a plant produced nothing until the next tick. It now
 * asks for gardens that are DUE (`listGardenIdsDueForEvaluation`): something
 * the engine reads changed since the garden's last evaluation, or its
 * watermark is older than `EVALUATION_STALENESS_FLOOR_MS`. A quiet garden
 * costs one indexed row in a single statement, so the sweep can run every
 * few minutes and a new plant earns its recommendations while the person is
 * still looking at the screen.
 *
 * The watermark is written inside the evaluation transaction — see
 * `GardenEvaluationStateRepository` for why that ordering, and not the
 * reverse, is the safe one.
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
 *
 * THIRD PHASE (P7-AI-01), LAST, OPTIONAL: the bounded AI-explanation
 * embellishment over candidates the earlier phases left presentable —
 * section 3's "optional Vertex AI bounded explanation", async by design
 * (never in the Today request path) and outside every evaluation
 * transaction (provider calls happen outside transactions). It runs
 * after expiry so just-expired candidates are not selected, and it is
 * `null` — the phase does not exist, zero provider calls — whenever the
 * `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch is off, which is
 * every environment today. Its failure modes never fail the sweep run:
 * every degradation is a typed count in its own summary, and the
 * deterministic explanations keep serving regardless (section 14).
 */

import { ConflictError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { expireRecommendationCandidate } from '../domain/recommendation-lifecycle.js';
import type { RuleSkipReason } from '../domain/rule-definition.js';
import type {
  EmbellishmentRunResult,
  RecommendationExplanationEmbellisher,
} from './embellish-recommendation-explanations.js';
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

/**
 * How long a garden may go unevaluated before it is due regardless of
 * whether anything changed.
 *
 * Six hours is the interval this sweep used to run at, so the floor
 * preserves exactly the old worst-case cadence for a garden nobody touches
 * while letting a garden that DID change be picked up within one short
 * tick. It exists because several rules are time-based — the 14-day
 * observation reminder, a forecast window opening — and a change-only trigger
 * would let a neglected garden fall silent precisely when its reminders
 * matter most.
 */
export const EVALUATION_STALENESS_FLOOR_MS = 6 * 60 * 60 * 1000;

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
  /**
   * Whole-rule skips across every evaluation this run, counted by typed
   * reason (P7-ANALYTICS-01). `weatherMissing`/`weatherStale` are the
   * degraded-input evaluations recommendations-and-ai.md section 17 and
   * external-integrations.md section 11 ask to measure — rule evaluations
   * that could not run (or refused stale input, per the rule's own declared
   * policy) leave no candidate row behind, so this counter is their ONLY
   * observable trace; the engine's decision entries are otherwise discarded
   * after persistence. Reason kinds only, never rule parameters or facts.
   */
  readonly ruleSkips: Readonly<Partial<Record<RuleSkipReason['kind'], number>>>;
  /** The AI-embellishment phase's own summary (P7-AI-01); `null` whenever the kill-switch keeps the phase from existing at all. */
  readonly embellishment: EmbellishmentRunResult | null;
}

export class RunRecommendationEvaluationSweep {
  constructor(
    private readonly gardens: EvaluationGardenSource,
    private readonly evaluateGardenRecommendations: GardenRecommendationEvaluator,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    /** `null` = AI explanation switched off: the phase is skipped structurally, zero provider calls (the P7-AI-01 kill-switch). */
    private readonly embellisher: RecommendationExplanationEmbellisher | null,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<RecommendationEvaluationSweepResult> {
    let gardensEvaluated = 0;
    let candidatesCreated = 0;
    let candidatesSuperseded = 0;
    let lostRaces = 0;
    const ruleSkips: Partial<Record<RuleSkipReason['kind'], number>> = {};

    let afterGardenId: Uuid | null = null;
    for (;;) {
      const page = await this.gardens.listGardenIdsDueForEvaluation(
        afterGardenId,
        EVALUATION_SWEEP_PAGE_SIZE,
        new Date(this.clock.now().getTime() - EVALUATION_STALENESS_FLOOR_MS),
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
            (candidate) => candidate.supersededLivePrior,
          ).length;
          for (const decision of result.decisions) {
            if (decision.kind === 'ruleSkipped') {
              ruleSkips[decision.reason.kind] = (ruleSkips[decision.reason.kind] ?? 0) + 1;
            }
          }
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

    // After expiry, so just-expired candidates are not selected — see the
    // header's third-phase comment.
    const embellishment = this.embellisher === null ? null : await this.embellisher.execute();

    return {
      gardensEvaluated,
      candidatesCreated,
      candidatesSuperseded,
      candidatesExpired: expiry.expired,
      lostRaces: lostRaces + expiry.lostRaces,
      ruleSkips,
      embellishment,
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
            // A non-locking writer won the row: the Today feedback commands
            // (P7-BE-01) transition presented candidates revision-guarded
            // WITHOUT taking this lock — a user completing a candidate in
            // exactly its expiry moment is a legitimate race the user wins.
            // Counted and retried next run, never poisoning the batch.
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
