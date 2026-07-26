import type { Kysely } from 'kysely';
import { KyselyAuditLogger } from '../../../platform/audit/kysely-audit-logger.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselyOutboxAppender } from '../../../platform/outbox/kysely-outbox-appender.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  CollaborationTransactionContext,
  CollaborationUnitOfWork,
} from '../application/collaboration-unit-of-work.js';
import { KyselyClientEngagementRepository } from './kysely-client-engagement-repository.js';
import { KyselyGardenAssignmentRepository } from './kysely-garden-assignment-repository.js';
import { KyselyOrganizationMembershipRepository } from './kysely-organization-membership-repository.js';
import { KyselyOrganizationRepository } from './kysely-organization-repository.js';

export class KyselyCollaborationUnitOfWork implements CollaborationUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: CollaborationTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: CollaborationTransactionContext = {
        organizations: new KyselyOrganizationRepository(trx),
        organizationMemberships: new KyselyOrganizationMembershipRepository(trx),
        gardenAssignments: new KyselyGardenAssignmentRepository(trx),
        clientEngagements: new KyselyClientEngagementRepository(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        outbox: new KyselyOutboxAppender(trx, this.clock),
        auditLogger: new KyselyAuditLogger(trx, this.clock),
      };

      return work(context);
    });
  }
}
