/**
 * Transaction boundary for media commands.
 *
 * `RegisterMediaRecord` is the only command this module has this pass, and
 * its only transactional requirement is that the media row and its
 * idempotency record commit or roll back together. Unlike gardens-mapping's
 * `CreateGarden`, there is no outbox event and no audit record here: this
 * minimal slice deliberately carries no eventing or audit trail of its own
 * (see `domain/media-record.ts` and the migration's doc comment on
 * `media.media_record` for what it deliberately omits).
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { MediaRepository } from './media-repository.js';

export interface MediaTransactionContext {
  readonly media: MediaRepository;
  readonly idempotency: IdempotencyStore;
}

export interface MediaUnitOfWork {
  run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T>;
}
