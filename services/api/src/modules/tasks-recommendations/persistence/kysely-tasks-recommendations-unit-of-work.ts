import type { Kysely } from 'kysely';
import { KyselyMapObjectRepository } from '../../gardens-mapping/public.js';
import { KyselyMediaRepository } from '../../media/public.js';
import { KyselyPlantRepository } from '../../plants-inventory/public.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselySyncChangeRecorder } from '../../../platform/sync/kysely-sync-change-recorder.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  TasksRecommendationsTransactionContext,
  TasksRecommendationsUnitOfWork,
} from '../application/tasks-recommendations-unit-of-work.js';
import { KyselyTaskAttachmentRepository } from './kysely-task-attachment-repository.js';
import { KyselyTaskRepository } from './kysely-task-repository.js';
import { KyselyTaskRevisionJournalWriter } from './kysely-task-revision-journal-writer.js';

export class KyselyTasksRecommendationsUnitOfWork implements TasksRecommendationsUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: TasksRecommendationsTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: TasksRecommendationsTransactionContext = {
        tasks: new KyselyTaskRepository(trx),
        taskAttachments: new KyselyTaskAttachmentRepository(trx),
        revisionJournal: new KyselyTaskRevisionJournalWriter(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        mapObjects: new KyselyMapObjectRepository(trx),
        plants: new KyselyPlantRepository(trx),
        media: new KyselyMediaRepository(trx),
        syncChanges: new KyselySyncChangeRecorder(trx),
      };

      return work(context);
    });
  }
}
