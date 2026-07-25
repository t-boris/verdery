/**
 * Kysely implementation of `DeletionUnitOfWork` (P8-DELETE-01) — the
 * `KyselyExportsUnitOfWork` shape, with more borrowed ports because deletion
 * spans more modules. Every borrowed repository is that module's own public
 * `Kysely*` class bound to this transaction; see the port's header for why
 * that is the composition pattern rather than a boundary breach.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyAuditLogger } from '../../../platform/audit/kysely-audit-logger.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselyOutboxAppender } from '../../../platform/outbox/kysely-outbox-appender.js';
import { KyselySyncChangeRecorder } from '../../../platform/sync/kysely-sync-change-recorder.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  KyselyGardenRepository,
  KyselyMembershipRepository,
} from '../../gardens-mapping/public.js';
import { KyselyProfileRepository } from '../../identity-access/public.js';
import type {
  DeletionTransactionContext,
  DeletionUnitOfWork,
} from '../application/deletion-unit-of-work.js';
import { KyselyDeletionRecordRepository } from './kysely-deletion-record-repository.js';
import { KyselyPurgeExecutor } from './kysely-purge-executor.js';

export class KyselyDeletionUnitOfWork implements DeletionUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: DeletionTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: DeletionTransactionContext = {
        deletionRecords: new KyselyDeletionRecordRepository(trx),
        gardens: new KyselyGardenRepository(trx),
        profiles: new KyselyProfileRepository(trx),
        memberships: new KyselyMembershipRepository(trx),
        purge: new KyselyPurgeExecutor(trx),
        syncChanges: new KyselySyncChangeRecorder(trx),
        outbox: new KyselyOutboxAppender(trx, this.clock),
        auditLogger: new KyselyAuditLogger(trx, this.clock),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
      };

      return work(context);
    });
  }
}
