/**
 * Transaction boundary for notifications commands (P7-NOTIF-01).
 *
 * `ApplyNotificationPolicy` binds the freshness read, the recipient read,
 * the preference reads, the supersession closes, and the intent inserts to
 * ONE transaction so the policy decides against a consistent snapshot and
 * its outcomes commit atomically; `ListNotifications` binds its expiry
 * marking and page read the same way; `UpdateNotificationPreferences`
 * binds the revision-guarded document replacement and its idempotency
 * record — the same rule every sibling module's unit of work documents.
 *
 * `recipients` and `recommendationFreshness` are transaction-bound narrow
 * READ ports over other modules' schemas (see each port's own header),
 * bound here because the policy's writes must be snapshot-consistent with
 * the reads that justified them.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { GardenRecipientSource } from './garden-recipient-source.js';
import type { NotificationDeliveryRepository } from './notification-delivery-repository.js';
import type { NotificationDeviceRepository } from './notification-device-repository.js';
import type { NotificationIntentRepository } from './notification-intent-repository.js';
import type { NotificationPreferenceRepository } from './notification-preference-repository.js';
import type { RecommendationFreshnessSource } from './recommendation-freshness-source.js';

export interface NotificationsTransactionContext {
  readonly intents: NotificationIntentRepository;
  readonly preferences: NotificationPreferenceRepository;
  readonly recipients: GardenRecipientSource;
  readonly recommendationFreshness: RecommendationFreshnessSource;
  readonly idempotency: IdempotencyStore;
  /** P7-NOTIF-02: device registration binds token displacement + upsert to one transaction; the sweep binds attempt records, device disables, and the intent outcome the same way. */
  readonly devices: NotificationDeviceRepository;
  readonly delivery: NotificationDeliveryRepository;
}

export interface NotificationsUnitOfWork {
  run<T>(work: (context: NotificationsTransactionContext) => Promise<T>): Promise<T>;
}
