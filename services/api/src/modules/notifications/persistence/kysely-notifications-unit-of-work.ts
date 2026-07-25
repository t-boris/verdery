import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../../platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  NotificationsTransactionContext,
  NotificationsUnitOfWork,
} from '../application/notifications-unit-of-work.js';
import { KyselyGardenRecipientSource } from './kysely-garden-recipient-source.js';
import { KyselyNotificationIntentRepository } from './kysely-notification-intent-repository.js';
import { KyselyNotificationPreferenceRepository } from './kysely-notification-preference-repository.js';
import { KyselyRecommendationFreshnessSource } from './kysely-recommendation-freshness-source.js';

export class KyselyNotificationsUnitOfWork implements NotificationsUnitOfWork {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async run<T>(work: (context: NotificationsTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const context: NotificationsTransactionContext = {
        intents: new KyselyNotificationIntentRepository(trx),
        preferences: new KyselyNotificationPreferenceRepository(trx),
        recipients: new KyselyGardenRecipientSource(trx),
        recommendationFreshness: new KyselyRecommendationFreshnessSource(trx),
        idempotency: new KyselyIdempotencyStore(trx, this.clock),
      };

      return work(context);
    });
  }
}
