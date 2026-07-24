/**
 * Port for the relay's own read/mark-published access to
 * `platform.outbox_event` — deliberately narrower than
 * `@verdery/api`'s own `OutboxAppender` (which only ever writes): this side
 * only ever reads unpublished, media-relevant rows and marks them published,
 * matching `verdery_worker`'s own grants exactly (SELECT, UPDATE — no
 * INSERT, no DELETE).
 *
 * Source: migrations/1784736116655_identity-and-gardens-baseline.sql,
 * `platform.outbox_event`; migrations/1785200000000_media-processing-jobs.sql
 * (`verdery_worker` grants); architecture/asynchronous-processing.md,
 * section "4. Transactional Outbox".
 */

export interface OutboxEventRecord {
  readonly id: string;
  readonly aggregateId: string;
  /**
   * `media.processing_requested` (P6-ASYNC-01) or, new in P6-WORKER-02,
   * `media.derivative_generation_requested` — `outbox-relay.ts`'s own
   * `jobKindForEventType` reads this to decide which `job_kind` a job
   * created for this event should carry, and therefore which processor
   * `services/api`'s `RecordMediaProcessingResult` will eventually route
   * its result to.
   */
  readonly eventType: string;
  /** Already the parsed JSON value — never a string needing a second `JSON.parse`. */
  readonly payload: unknown;
  readonly traceId: string | null;
}

export interface OutboxEventStore {
  /**
   * Claims up to `limit` unpublished, media-processing-relevant outbox rows
   * (both event types this relay recognizes — see `OutboxEventRecord.eventType`'s
   * own doc comment), oldest first. "Claims" here means "reads" — this
   * stage's own crash-recovery design (see `outbox-relay.ts`'s own header
   * comment) does not need a row-level lock: idempotent job creation and
   * Cloud Tasks' own deterministic task-name deduplication are what make a
   * row processed twice safe, not exclusivity of the read itself.
   */
  claimUnpublished(limit: number): Promise<readonly OutboxEventRecord[]>;

  /** Marks one row published, incrementing its attempt counter. */
  markPublished(id: string, now: Date): Promise<void>;
}
