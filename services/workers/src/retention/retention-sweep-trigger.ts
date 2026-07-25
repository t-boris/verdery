/**
 * Posts one authenticated trigger to `services/api`'s internal
 * retention-sweep endpoint (P6-RET-01).
 *
 * The sweep — scanning `media.media_record` for passed retention deadlines
 * and stale never-completed uploads, and every privileged transition that
 * follows — runs entirely in the API process: `verdery_worker` has
 * deliberately never been able to read `media.media_record`
 * (1785200000000_media-processing-jobs.sql's own grant reasoning), and
 * widening that grant so this worker could scan the table itself would
 * trade an established, documented privilege boundary for the convenience
 * of one query. This worker contributes exactly what it uniquely has: a
 * process that is already awake on an interval (the relay's own poll loop
 * precedent — no Cloud Scheduler convention exists in this codebase yet)
 * and an OIDC identity the API already verifies. `GoogleApiResultRecorder`
 * is the shape precedent: same `google-auth-library` ID-token client, same
 * audience as the result callback, so both worker-to-API paths present one
 * identity.
 */

import { GoogleAuth } from 'google-auth-library';
import type { Logger } from '../logger.js';

/** Mirrors `services/api`'s `MediaRetentionSweepResult` — duplicated narrowly per the worker boundary, the same posture `job-kind.ts` documents. */
export interface RetentionSweepSummary {
  readonly retentionScheduled: number;
  readonly retentionSkippedReferenced: number;
  readonly staleScheduled: number;
  readonly lostRaces: number;
}

export interface RetentionSweepTrigger {
  /** Runs one sweep round-trip. Throws on transport/authentication failure — the scheduler logs and waits for the next interval. */
  trigger(): Promise<RetentionSweepSummary>;
}

export class GoogleApiRetentionSweepTrigger implements RetentionSweepTrigger {
  private readonly auth = new GoogleAuth();

  constructor(
    private readonly sweepUrl: string,
    private readonly audience: string,
    private readonly logger: Logger,
  ) {}

  async trigger(): Promise<RetentionSweepSummary> {
    const client = await this.auth.getIdTokenClient(this.audience);
    const response = await client.request<RetentionSweepSummary>({
      method: 'POST',
      url: this.sweepUrl,
      headers: { 'Content-Type': 'application/json' },
    });

    const summary = response.data;
    // Logged on EVERY successful round-trip, all-zero counts included
    // (P6-OBS-01): the hourly cadence of this one line is the sweep's own
    // liveness signal — an absence-based alert ("no sweep completed for
    // N hours") is only writable if the nothing-to-do case still emits,
    // and at one line per hour the volume cost is nil. Counts only —
    // never media ids, filenames, or URLs (architecture section 19's
    // logging posture).
    this.logger.info(
      { event: 'retention.sweep_completed', ...summary },
      'Retention sweep completed',
    );
    return summary;
  }
}
