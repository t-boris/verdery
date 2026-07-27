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
import { KyselyClientAccessGrantRepository } from './kysely-client-access-grant-repository.js';
import { KyselyClientEngagementRepository } from './kysely-client-engagement-repository.js';
import { KyselyClientUpdateItemRepository } from './kysely-client-update-item-repository.js';
import { KyselyClientUpdateRepository } from './kysely-client-update-repository.js';
import { KyselyGardenAssignmentRepository } from './kysely-garden-assignment-repository.js';
import { KyselyOrganizationMembershipRepository } from './kysely-organization-membership-repository.js';
import { KyselyOrganizationRepository } from './kysely-organization-repository.js';
import { KyselyPublicationRepository } from './kysely-publication-repository.js';
import { KyselyPublisherGrantRepository } from './kysely-publisher-grant-repository.js';
import { KyselyWorkLogRepository } from './kysely-work-log-repository.js';

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
        publisherGrants: new KyselyPublisherGrantRepository(trx),
        clientAccessGrants: new KyselyClientAccessGrantRepository(trx),
        clientUpdates: new KyselyClientUpdateRepository(trx),
        clientUpdateItems: new KyselyClientUpdateItemRepository(trx),
        workLogs: new KyselyWorkLogRepository(trx),
        publications: new KyselyPublicationRepository(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        outbox: new KyselyOutboxAppender(trx, this.clock),
        auditLogger: new KyselyAuditLogger(trx, this.clock),
      };

      return work(context);
    });
  }
}
