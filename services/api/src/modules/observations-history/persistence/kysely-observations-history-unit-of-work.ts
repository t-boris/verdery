import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import { KyselySyncChangeRecorder } from '../../../platform/sync/kysely-sync-change-recorder.js';
import type { Clock } from '../../../shared/time/clock.js';
import { KyselyMediaRepository } from '../../media/public.js';
import type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from '../application/observations-history-unit-of-work.js';
import { KyselyImageAnalysisResultRepository } from './kysely-image-analysis-result-repository.js';
import { KyselyObservationPhotoRepository } from './kysely-observation-photo-repository.js';
import { KyselyObservationRepository } from './kysely-observation-repository.js';
import { KyselyPlantOwnershipRepository } from './kysely-plant-ownership-repository.js';

export class KyselyObservationsHistoryUnitOfWork implements ObservationsHistoryUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: ObservationsHistoryTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: ObservationsHistoryTransactionContext = {
        observations: new KyselyObservationRepository(trx),
        observationPhotos: new KyselyObservationPhotoRepository(trx),
        imageAnalysisResults: new KyselyImageAnalysisResultRepository(trx),
        plants: new KyselyPlantOwnershipRepository(trx),
        media: new KyselyMediaRepository(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
        syncChanges: new KyselySyncChangeRecorder(trx),
      };

      return work(context);
    });
  }
}
