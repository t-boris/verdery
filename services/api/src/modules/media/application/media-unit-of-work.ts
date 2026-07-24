/**
 * Transaction boundary for media commands.
 *
 * `RegisterMediaRecord` (P6-DATA-01) needed only the media row and its
 * idempotency record to commit or roll back together. P6-API-01 adds
 * `quotaReservations`: `RegisterMediaUpload` inserts a media row AND a quota
 * reservation in the same transaction, and `CompleteMediaUpload` updates the
 * media row AND commits/releases that reservation in the same transaction —
 * both pairs must commit or roll back atomically, the same "domain state and
 * its related records commit atomically" requirement every other module's
 * unit of work already enforces. Still no audit record for the media row
 * itself (see `domain/media-record.ts` and the migration's doc comment on
 * `media.media_record` for what it deliberately omits); `GetMediaAccess`'s
 * own sensitive-access audit record is a read-path concern and is written
 * through the platform `AuditLogger` outside this transaction boundary, not
 * through this context.
 *
 * P6-ASYNC-01 adds two more bindings, both used by real callers this stage:
 *
 * - `outbox`: `CompleteMediaUpload` appends the `media.processing_requested`
 *   event in the same transaction as the `available` write itself — the
 *   ordinary "domain state and its outbox events commit atomically"
 *   requirement (architecture/backend-modular-monolith.md section
 *   "12. Transactions"), never wired for this module until now because
 *   nothing here emitted a domain event before this stage.
 * - `processingJobs`: `record-media-processing-result.ts` loads a job, loads
 *   the media it belongs to, and writes both the job's terminal state and
 *   the media record's `processingState` in one transaction — see that
 *   file's own header comment for why this is a direct write rather than a
 *   second outbox round trip.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { MediaRepository } from './media-repository.js';
import type { ProcessingJobRepository } from './processing-job-repository.js';
import type { QuotaReservationRepository } from './quota-reservation-repository.js';

export interface MediaTransactionContext {
  readonly media: MediaRepository;
  readonly quotaReservations: QuotaReservationRepository;
  readonly idempotency: IdempotencyStore;
  readonly outbox: OutboxAppender;
  readonly processingJobs: ProcessingJobRepository;
}

export interface MediaUnitOfWork {
  run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T>;
}
