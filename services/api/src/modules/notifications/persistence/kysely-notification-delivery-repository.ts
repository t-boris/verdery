/**
 * Kysely implementation of `NotificationDeliveryRepository` (P7-NOTIF-02).
 *
 * The claim and the bulk expiry are single atomic UPDATE statements over a
 * `FOR UPDATE SKIP LOCKED` subselect — concurrent sweep runs partition the
 * due set instead of double-claiming (the port's header documents the
 * lease semantics). Terminal writes are state-conditional
 * (`WHERE state = 'pending'`), the module's established SQL form of the
 * intent state machine.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { NotificationIntent } from '../domain/notification-intent.js';
import type {
  NewDeliveryAttempt,
  NotificationDeliveryRepository,
} from '../application/notification-delivery-repository.js';
import { toIntent } from './intent-row-mapping.js';

export class KyselyNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async claimDueForDelivery(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<readonly NotificationIntent[]> {
    const rows = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        next_delivery_attempt_at: leaseUntil,
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('notifications.notification_intent')
          .select('id')
          .where('state', '=', 'pending')
          .where('channel_push', '=', true)
          .where('earliest_delivery_at', '<=', now)
          .where((inner) =>
            inner.or([
              inner('next_delivery_attempt_at', 'is', null),
              inner('next_delivery_attempt_at', '<=', now),
            ]),
          )
          .where('expires_at', '>', now)
          .orderBy('id')
          .limit(limit)
          .forUpdate()
          .skipLocked(),
      )
      .returningAll()
      .execute();

    // The UPDATE's returned order is unspecified; UUIDv7 id order restores
    // oldest-first processing.
    return [...rows].sort((a, b) => a.id.localeCompare(b.id)).map(toIntent);
  }

  async expireDuePending(now: Date, limit: number): Promise<number> {
    const result = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        state: 'expired',
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('notifications.notification_intent')
          .select('id')
          .where('state', '=', 'pending')
          .where('expires_at', '<=', now)
          .orderBy('id')
          .limit(limit)
          .forUpdate()
          .skipLocked(),
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  async markSent(id: Uuid, attemptCount: number, now: Date): Promise<boolean> {
    const result = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        state: 'sent',
        delivery_attempt_count: attemptCount,
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async closeDelivery(
    id: Uuid,
    state: 'failed' | 'skipped' | 'expired',
    reason: string | null,
    now: Date,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        state,
        close_reason: reason,
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async scheduleRetry(
    id: Uuid,
    nextAttemptAt: Date,
    attemptCount: number,
    now: Date,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        next_delivery_attempt_at: nextAttemptAt,
        delivery_attempt_count: attemptCount,
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async recordAttempts(attempts: readonly NewDeliveryAttempt[]): Promise<void> {
    if (attempts.length === 0) {
      return;
    }
    await this.db
      .insertInto('notifications.notification_delivery_attempt')
      .values(
        attempts.map((attempt) => ({
          id: attempt.id,
          intent_id: attempt.intentId,
          device_id: attempt.deviceId,
          outcome: attempt.outcome,
          error_code: attempt.errorCode,
          attempted_at: attempt.attemptedAt,
        })),
      )
      .execute();
  }
}
