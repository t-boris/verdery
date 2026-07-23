import type { Kysely } from 'kysely';
import { KyselyAuditLogger } from '../../../platform/audit/kysely-audit-logger.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselyOutboxAppender } from '../../../platform/outbox/kysely-outbox-appender.js';
import { KyselySyncChangeRecorder } from '../../../platform/sync/kysely-sync-change-recorder.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  GardensMappingTransactionContext,
  GardensMappingUnitOfWork,
} from '../application/gardens-mapping-unit-of-work.js';
import { KyselyCalibrationRepository } from './kysely-calibration-repository.js';
import { KyselyCoordinateSpaceRepository } from './kysely-coordinate-space-repository.js';
import { KyselyGardenRepository } from './kysely-garden-repository.js';
import { KyselyMapObjectRepository } from './kysely-map-object-repository.js';
import { KyselyMembershipRepository } from './kysely-membership-repository.js';
import { KyselyRevisionJournalWriter } from './kysely-revision-journal-writer.js';

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
        mapObjects: new KyselyMapObjectRepository(trx),
        coordinateSpaces: new KyselyCoordinateSpaceRepository(trx),
        calibrations: new KyselyCalibrationRepository(trx),
        revisionJournal: new KyselyRevisionJournalWriter(trx),
        syncChanges: new KyselySyncChangeRecorder(trx),
      };

      return work(context);
    });
  }
}
