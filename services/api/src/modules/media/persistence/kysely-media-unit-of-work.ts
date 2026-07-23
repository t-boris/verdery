import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  MediaTransactionContext,
  MediaUnitOfWork,
} from '../application/media-unit-of-work.js';
import { KyselyMediaRepository } from './kysely-media-repository.js';

export class KyselyMediaUnitOfWork implements MediaUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: MediaTransactionContext = {
        media: new KyselyMediaRepository(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
      };

      return work(context);
    });
  }
}
