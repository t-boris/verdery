/**
 * The exports module's transaction boundary (P8-EXPORT-01) — the
 * `MediaUnitOfWork` shape. `media` is the media module's own PUBLIC
 * repository port bound to the same transaction: `CompleteExport`
 * registers the `export_package` media record atomically with the
 * request's `completed` transition and the `export.completed` outbox
 * event, so a crash can never leave a downloadable package without a
 * completed request or vice versa. Constructing another module's public
 * repository over the shared transaction is the composition-root pattern
 * (`public.ts` is the one legal import surface), not a private reach-in.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { MediaRepository } from '../../media/public.js';
import type { ExportRequestRepository } from './export-request-repository.js';

export interface ExportsTransactionContext {
  readonly exportRequests: ExportRequestRepository;
  readonly media: MediaRepository;
  readonly outbox: OutboxAppender;
  readonly idempotency: IdempotencyStore;
}

export interface ExportsUnitOfWork {
  run<T>(work: (context: ExportsTransactionContext) => Promise<T>): Promise<T>;
}
