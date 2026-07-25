/**
 * Kysely implementation of `NotificationIntentRepository` (P7-NOTIF-01).
 *
 * Lifecycle edges are state-conditional UPDATEs (`WHERE state = 'pending'`)
 * so a concurrent close is a counted no-op, never an overwrite; the inbox
 * view stamps are single-statement COALESCE set-once writes that converge
 * under concurrent duplicates. The dedup insert is `ON CONFLICT DO
 * NOTHING` against the unique `(recipient_profile_id, dedup_key)` index —
 * notifications.md section 10 in one clause.
 */

import { sql, type Kysely, type Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NotificationDeepLink,
  NotificationIntent,
  NotificationIntentState,
  NotificationPriority,
} from '../domain/notification-intent.js';
import type {
  NewNotificationIntent,
  NotificationIntentRepository,
} from '../application/notification-intent-repository.js';
import type { NotificationIntentRow } from './schema.js';

function toIntent(row: Selectable<NotificationIntentRow>): NotificationIntent {
  return {
    id: row.id,
    intentType: row.intent_type,
    intentVersion: row.intent_version,
    recipientProfileId: row.recipient_profile_id,
    gardenId: row.garden_id,
    recommendationCandidateId: row.recommendation_candidate_id,
    sourceEventId: row.source_event_id,
    traceId: row.trace_id,
    templateKey: row.template_key,
    // Written exclusively by this module's own policy; jsonb round-trips
    // already parsed.
    templateParameters: row.template_parameters as Readonly<Record<string, unknown>>,
    priority: row.priority as NotificationPriority,
    channelInApp: row.channel_in_app,
    channelPush: row.channel_push,
    deepLink: row.deep_link as NotificationDeepLink,
    dedupKey: row.dedup_key,
    earliestDeliveryAt: row.earliest_delivery_at,
    expiresAt: row.expires_at,
    state: row.state as NotificationIntentState,
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyNotificationIntentRepository implements NotificationIntentRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insertIfAbsent(intent: NewNotificationIntent, now: Date): Promise<boolean> {
    const result = await this.db
      .insertInto('notifications.notification_intent')
      .values({
        id: intent.id,
        intent_type: intent.intentType,
        intent_version: intent.intentVersion,
        recipient_profile_id: intent.recipientProfileId,
        garden_id: intent.gardenId,
        recommendation_candidate_id: intent.recommendationCandidateId,
        source_event_id: intent.sourceEventId,
        trace_id: intent.traceId,
        template_key: intent.templateKey,
        template_parameters: JSON.stringify(intent.templateParameters),
        priority: intent.priority,
        channel_in_app: intent.channelInApp,
        channel_push: intent.channelPush,
        deep_link: JSON.stringify(intent.deepLink),
        dedup_key: intent.dedupKey,
        earliest_delivery_at: intent.earliestDeliveryAt,
        expires_at: intent.expiresAt,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.columns(['recipient_profile_id', 'dedup_key']).doNothing())
      .executeTakeFirst();

    return Number(result.numInsertedOrUpdatedRows ?? 0n) > 0;
  }

  async closePendingForCandidate(candidateId: Uuid, now: Date): Promise<number> {
    const result = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        state: 'superseded',
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('recommendation_candidate_id', '=', candidateId)
      .where('state', '=', 'pending')
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  async expirePendingForRecipient(recipientProfileId: Uuid, now: Date): Promise<number> {
    const result = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        state: 'expired',
        revision: sql`revision + 1`,
        updated_at: now,
      })
      .where('recipient_profile_id', '=', recipientProfileId)
      .where('state', '=', 'pending')
      .where('expires_at', '<=', now)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  async listInboxPage(
    recipientProfileId: Uuid,
    beforeId: Uuid | null,
    limit: number,
  ): Promise<readonly NotificationIntent[]> {
    let query = this.db
      .selectFrom('notifications.notification_intent')
      .selectAll()
      .where('recipient_profile_id', '=', recipientProfileId)
      .where('state', '=', 'pending')
      .where('channel_in_app', '=', true)
      .where('dismissed_at', 'is', null);

    if (beforeId !== null) {
      query = query.where('id', '<', beforeId);
    }

    const rows = await query.orderBy('id', 'desc').limit(limit).execute();
    return rows.map(toIntent);
  }

  async findForRecipient(id: Uuid, recipientProfileId: Uuid): Promise<NotificationIntent | null> {
    const row = await this.db
      .selectFrom('notifications.notification_intent')
      .selectAll()
      .where('id', '=', id)
      .where('recipient_profile_id', '=', recipientProfileId)
      .executeTakeFirst();

    return row === undefined ? null : toIntent(row);
  }

  async markRead(
    id: Uuid,
    recipientProfileId: Uuid,
    now: Date,
  ): Promise<NotificationIntent | null> {
    return this.stampOnce(id, recipientProfileId, 'read_at', now);
  }

  async markDismissed(
    id: Uuid,
    recipientProfileId: Uuid,
    now: Date,
  ): Promise<NotificationIntent | null> {
    return this.stampOnce(id, recipientProfileId, 'dismissed_at', now);
  }

  /**
   * One statement that sets the column only when still null (COALESCE
   * keeps the first stamp) and bumps revision/updated_at only when it
   * actually wrote — concurrent duplicates converge on identical state.
   */
  private async stampOnce(
    id: Uuid,
    recipientProfileId: Uuid,
    column: 'read_at' | 'dismissed_at',
    now: Date,
  ): Promise<NotificationIntent | null> {
    const columnRef = sql.ref(column);
    const row = await this.db
      .updateTable('notifications.notification_intent')
      .set({
        [column]: sql`COALESCE(${columnRef}, ${now})`,
        revision: sql`revision + CASE WHEN ${columnRef} IS NULL THEN 1 ELSE 0 END`,
        updated_at: sql`CASE WHEN ${columnRef} IS NULL THEN ${now} ELSE updated_at END`,
      })
      .where('id', '=', id)
      .where('recipient_profile_id', '=', recipientProfileId)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toIntent(row);
  }
}
