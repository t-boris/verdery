/**
 * Pass/fail thresholds, tied one-to-one to the PROPOSED numbers in
 * docs/development/service-levels.md.
 *
 * The point of this module is that a load run cannot silently disagree with the
 * SLO draft. If an owner changes a target there, exactly one constant changes
 * here, and every scenario that asserts against it moves with it.
 *
 * Nothing in service-levels.md is approved yet, so nothing here is a committed
 * threshold either — a failing run means "this does not meet the PROPOSED
 * target", which is evidence for the approval decision, not a defect report.
 */

/** SLI-2 — read latency, p95/p99 in milliseconds. */
export const READ_LATENCY_P95_MS = 400;
export const READ_LATENCY_P99_MS = 1500;

/** SLI-3 — mutation latency, p95/p99 in milliseconds. */
export const MUTATION_LATENCY_P95_MS = 800;
export const MUTATION_LATENCY_P99_MS = 2500;

/** SLI-1 — core API availability. Expressed as the failure budget. */
export const MAX_REQUEST_FAILURE_RATE = 0.005;

/** SLI-4 — synchronization push acceptance, as the tolerated rejection share. */
export const MAX_PUSH_REJECTION_RATE = 0.05;

/** SLI-5 — full-resynchronization rate. */
export const MAX_FULL_RESYNC_RATE = 0.02;

/** SLI-6 — synchronous upload verification failure share. */
export const MAX_UPLOAD_REJECTION_RATE = 0.05;

/**
 * Contract and platform ceilings the scenarios probe rather than assume.
 * Every value is read from the code it constrains, not chosen here.
 */
export const LIMITS = {
  /** `MAX_PUSH_BATCH_SIZE`, `parse-sync-request.ts`. */
  syncPushBatch: 500,
  /** `MAX_DEPENDS_ON_IDS`, same file. */
  syncDependsOnIds: 20,
  /** `MAX_CHANGES_LIMIT`, `sync-routes.ts`; the contract's `Limit` maximum. */
  pageLimit: 100,
  /** `TODAY_MAX_LIMIT`, `get-today-view.ts`. */
  todayLimit: 25,
  /** `HTTP_BODY_LIMIT_BYTES` default — global, with no per-route override. */
  bodyLimitBytes: 1_048_576,
  /** `validation-policy.ts`, `garden_photo`. */
  gardenPhotoMaxBytes: 25 * 1024 * 1024,
  /** `validation-policy.ts`, `imported_plan`. */
  importedPlanMaxBytes: 50 * 1024 * 1024,
};

/**
 * Standard threshold block for a scenario dominated by reads.
 *
 * `http_req_failed` is the availability assertion; the duration thresholds are
 * SLI-2. `abortOnFail` is deliberately NOT set: a run that breaches a proposed
 * target should finish and report the whole distribution, because the shape of
 * the breach is the evidence.
 */
export function readThresholds() {
  return {
    http_req_failed: [`rate<${MAX_REQUEST_FAILURE_RATE}`],
    http_req_duration: [`p(95)<${READ_LATENCY_P95_MS}`, `p(99)<${READ_LATENCY_P99_MS}`],
  };
}

/** Standard threshold block for a scenario dominated by mutations. */
export function mutationThresholds() {
  return {
    http_req_failed: [`rate<${MAX_REQUEST_FAILURE_RATE}`],
    http_req_duration: [`p(95)<${MUTATION_LATENCY_P95_MS}`, `p(99)<${MUTATION_LATENCY_P99_MS}`],
  };
}
