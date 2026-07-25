/**
 * Kysely implementation of `ExportsUnitOfWork` (P8-EXPORT-01) — the
 * `KyselyMediaUnitOfWork` shape. `media` is the media module's own PUBLIC
 * `KyselyMediaRepository` bound to this transaction — see the port's
 * header for why that cross-module construction is the composition
 * pattern, not a boundary breach.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselyOutboxAppender } from '../../../platform/outbox/kysely-outbox-appender.js';
import type { Clock } from '../../../shared/time/clock.js';
import { KyselyMediaRepository } from '../../media/public.js';
import type {
  ExportsTransactionContext,
  ExportsUnitOfWork,
} from '../application/exports-unit-of-work.js';
import { KyselyExportRequestRepository } from './kysely-export-request-repository.js';

export class KyselyExportsUnitOfWork implements ExportsUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: ExportsTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: ExportsTransactionContext = {
        exportRequests: new KyselyExportRequestRepository(trx),
        media: new KyselyMediaRepository(trx),
        outbox: new KyselyOutboxAppender(trx, this.clock),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
      };

      return work(context);
    });
  }
}
