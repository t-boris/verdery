/**
 * Port for the relay's own create/advance-to-queued access to
 * `media.processing_job`.
 *
 * A deliberately minimal view of a job — id, media id, and state only, none
 * of the manifest/result fields `@verdery/api`'s own richer
 * `domain/processing-job.ts` type carries. The relay never reads or writes
 * those; it only ever needs to know "does a job already exist for this
 * event, and has it already been queued" — see `outbox-relay.ts`'s own
 * header comment for why that is enough.
 *
 * Source: migrations/1785200000000_media-processing-jobs.sql.
 */

export type RelayProcessingJobState =
  | 'requested'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'cancelled'
  | 'expired';

export interface RelayProcessingJob {
  readonly id: string;
  readonly mediaId: string;
  readonly processorConfigVersion: string;
  readonly state: RelayProcessingJobState;
}

export interface EnsureRequestedInput {
  readonly id: string;
  readonly mediaId: string;
  readonly processorConfigVersion: string;
  readonly inputChecksums: readonly string[];
  readonly traceId: string | null;
}

export interface ProcessingJobStore {
  /**
   * Idempotent job creation keyed by `input.id` — the relay always calls
   * this with `input.id` set to the triggering outbox event's own id (see
   * `outbox-relay.ts`). If a row already exists at that id, its EXISTING
   * state is returned unchanged; otherwise a new row is inserted in the
   * `requested` state and returned. Never throws on a duplicate id — this
   * is the concrete mechanism behind "a relay run twice must not enqueue
   * the same event twice."
   */
  ensureRequested(input: EnsureRequestedInput, now: Date): Promise<RelayProcessingJob>;

  /** `requested` -> `queued`. Called only after the Cloud Tasks enqueue call itself already succeeded. */
  markQueued(id: string, now: Date): Promise<void>;
}
