/**
 * Worker-to-API sweep triggers (P6-RET-01 established the shape;
 * P7-ASYNC-01 generalized it when the third and fourth sweep arrived).
 *
 * Every sweep — media retention, weather refresh, recommendation
 * evaluation — runs entirely in `services/api` behind an authenticated
 * internal endpoint, because the privileged reads and writes each sweep
 * performs live there: `verdery_worker` has deliberately never been able to
 * read `media.media_record`, any `gardens_mapping`/`plants_inventory`
 * table, `integrations.*`, or the recommendation tables, and widening those
 * grants so this worker could run the sweeps itself would trade documented
 * privilege boundaries for a few queries' convenience. This worker
 * contributes exactly what it uniquely has: a process that is already awake
 * on an interval (the relay's own poll loop precedent — no Cloud Scheduler
 * convention exists in this codebase yet) and an OIDC identity the API
 * already verifies.
 *
 * The summary interfaces mirror each `services/api` sweep's own result type
 * — duplicated narrowly per the worker boundary, the same posture
 * `job-kind.ts` documents.
 */

export interface SweepTrigger<TSummary extends object> {
  /** Runs one sweep round-trip. Throws on transport/authentication failure — the scheduler logs and waits for the next interval. */
  trigger(): Promise<TSummary>;
}

/** Mirrors `services/api`'s `MediaRetentionSweepResult`. */
export interface RetentionSweepSummary {
  readonly retentionScheduled: number;
  readonly retentionSkippedReferenced: number;
  readonly staleScheduled: number;
  readonly lostRaces: number;
}

/** Mirrors `services/api`'s `WeatherRefreshSweepResult`. */
export interface WeatherRefreshSweepSummary {
  readonly gardensConsidered: number;
  readonly refreshed: number;
  readonly freshCacheHits: number;
  readonly staleServed: number;
  readonly unavailable: number;
  readonly degradationReasons: Readonly<Record<string, number>>;
  readonly stoppedOnQuotaExhaustion: boolean;
}

/** Mirrors `services/api`'s `EmbellishmentRunResult` (P7-AI-01) — the sweep's AI-embellishment phase summary. */
export interface RecommendationEmbellishmentSummary {
  readonly candidatesConsidered: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly rejectionOutcomes: Readonly<Record<string, number>>;
  readonly transientFailures: number;
  readonly lostRaces: number;
  readonly stoppedOnQuotaExhaustion: boolean;
}

/** Mirrors `services/api`'s `RecommendationEvaluationSweepResult`. */
export interface RecommendationEvaluationSweepSummary {
  readonly gardensEvaluated: number;
  readonly candidatesCreated: number;
  readonly candidatesSuperseded: number;
  readonly candidatesExpired: number;
  readonly lostRaces: number;
  /** `null` whenever the API's `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch keeps the phase from existing (every environment today). */
  readonly embellishment: RecommendationEmbellishmentSummary | null;
}
