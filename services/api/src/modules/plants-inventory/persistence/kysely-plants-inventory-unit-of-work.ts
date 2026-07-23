import type { Kysely } from 'kysely';
import { KyselyMapObjectRepository } from '../../gardens-mapping/public.js';
import { KyselyMediaRepository } from '../../media/public.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselySyncChangeRecorder } from '../../../platform/sync/kysely-sync-change-recorder.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  PlantsInventoryTransactionContext,
  PlantsInventoryUnitOfWork,
} from '../application/plants-inventory-unit-of-work.js';
import { KyselyPlantIdentificationRepository } from './kysely-plant-identification-repository.js';
import { KyselyPlantPhotoRepository } from './kysely-plant-photo-repository.js';
import { KyselyPlantRepository } from './kysely-plant-repository.js';
import { KyselyPlantRevisionJournalWriter } from './kysely-plant-revision-journal-writer.js';

export class KyselyPlantsInventoryUnitOfWork implements PlantsInventoryUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: PlantsInventoryTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: PlantsInventoryTransactionContext = {
        plants: new KyselyPlantRepository(trx),
        plantPhotos: new KyselyPlantPhotoRepository(trx),
        plantIdentifications: new KyselyPlantIdentificationRepository(trx),
        revisionJournal: new KyselyPlantRevisionJournalWriter(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        mapObjects: new KyselyMapObjectRepository(trx),
        media: new KyselyMediaRepository(trx),
        syncChanges: new KyselySyncChangeRecorder(trx),
      };

      return work(context);
    });
  }
}
