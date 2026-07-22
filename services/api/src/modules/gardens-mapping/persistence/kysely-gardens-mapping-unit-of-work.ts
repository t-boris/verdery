import type { Kysely } from 'kysely';
import { KyselyAuditLogger } from '../../../platform/audit/kysely-audit-logger.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselyOutboxAppender } from '../../../platform/outbox/kysely-outbox-appender.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  GardensMappingTransactionContext,
  GardensMappingUnitOfWork,
} from '../application/gardens-mapping-unit-of-work.js';
import { KyselyGardenRepository } from './kysely-garden-repository.js';
import { KyselyMembershipRepository } from './kysely-membership-repository.js';

export class KyselyGardensMappingUnitOfWork implements GardensMappingUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: GardensMappingTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: GardensMappingTransactionContext = {
        gardens: new KyselyGardenRepository(trx),
        memberships: new KyselyMembershipRepository(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        outbox: new KyselyOutboxAppender(trx, this.clock),
        auditLogger: new KyselyAuditLogger(trx, this.clock),
      };

      return work(context);
    });
  }
}
