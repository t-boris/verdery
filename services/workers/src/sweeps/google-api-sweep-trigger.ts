/**
 * Posts one authenticated trigger to a `services/api` internal sweep
 * endpoint — the P6-RET-01 retention trigger generalized over WHICH sweep,
 * once P7-ASYNC-01's two new sweeps made it three identical round-trips
 * differing only in URL and log event.
 *
 * `GoogleApiResultRecorder` remains the shape precedent: the same
 * `google-auth-library` ID-token client, and every sweep authenticates for
 * the SAME audience as the processing-result callback, so all
 * worker-to-API paths present one identity rather than several that could
 * drift.
 */

import { GoogleAuth } from 'google-auth-library';
import type { Logger } from '../logger.js';
import type { SweepTrigger } from './sweep-trigger.js';

export interface SweepLogEvents {
  /** The structured `event` value logged on every successful round-trip, e.g. `'retention.sweep_completed'`. */
  readonly completedEvent: string;
  /** The human-readable message accompanying it. */
  readonly completedMessage: string;
}

export class GoogleApiSweepTrigger<TSummary extends object> implements SweepTrigger<TSummary> {
  private readonly auth = new GoogleAuth();

  constructor(
    private readonly sweepUrl: string,
    private readonly audience: string,
    private readonly events: SweepLogEvents,
    private readonly logger: Logger,
  ) {}

  async trigger(): Promise<TSummary> {
    const client = await this.auth.getIdTokenClient(this.audience);
    const response = await client.request<TSummary>({
      method: 'POST',
      url: this.sweepUrl,
      headers: { 'Content-Type': 'application/json' },
      // An empty object, not an absent body. These sweeps take no input, but
      // the request announces a JSON content type, and Fastify rejects a
      // POST that declares JSON and then sends nothing — before the route
      // handler, in under a millisecond, as a plain 400 with no error log.
      // Every sweep in this service failed that way and had never once
      // succeeded; the hourly ones simply failed too rarely to notice.
      //
      // Sending `{}` rather than dropping the header keeps the fix
      // deterministic: whether a bodyless POST carries a content type at all
      // is up to the HTTP client's defaults, and a contract this quiet
      // should not depend on them.
      //
      // `data`, NOT `body`. This client is gaxios, which serializes `data`
      // and has no `body` of its own — but its options extend fetch's
      // `RequestInit`, where `body` does exist, so `body: {}` type-checks
      // cleanly, is then ignored at runtime, and changes nothing at all. The
      // first attempt at this fix used it and shipped an identical 400.
      data: {},
    });

    const summary = response.data;
    // Logged on EVERY successful round-trip, all-zero counts included
    // (P6-OBS-01): the fixed cadence of this one line is each sweep's own
    // liveness signal — an absence-based alert ("no sweep completed for
    // N hours") is only writable if the nothing-to-do case still emits,
    // and at one line per interval the volume cost is nil. Counts only —
    // never garden ids, media ids, filenames, or URLs (architecture
    // section 19's logging posture).
    const logRecord: Record<string, unknown> = { event: this.events.completedEvent, ...summary };
    this.logger.info(logRecord, this.events.completedMessage);
    return summary;
  }
}
