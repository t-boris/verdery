import type { Kysely } from 'kysely';
import { KyselyAuditLogger } from '../../../platform/audit/kysely-audit-logger.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselyOutboxAppender } from '../../../platform/outbox/kysely-outbox-appender.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  MediaTransactionContext,
  MediaUnitOfWork,
} from '../application/media-unit-of-work.js';
import { KyselyMediaReferenceFinder } from './kysely-media-reference-finder.js';
import { KyselyMediaRepository } from './kysely-media-repository.js';
import { KyselyProcessingJobRepository } from './kysely-processing-job-repository.js';
import { KyselyQuotaReservationRepository } from './kysely-quota-reservation-repository.js';

export class KyselyMediaUnitOfWork implements MediaUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: MediaTransactionContext = {
        media: new KyselyMediaRepository(trx),
        quotaReservations: new KyselyQuotaReservationRepository(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        outbox: new KyselyOutboxAppender(trx, this.clock),
        processingJobs: new KyselyProcessingJobRepository(trx),
        audit: new KyselyAuditLogger(trx, this.clock),
        references: new KyselyMediaReferenceFinder(trx),
      };

      return work(context);
    });
  }
}
