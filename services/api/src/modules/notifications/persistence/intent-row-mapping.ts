/**
 * The one `notification_intent` row-to-entity mapping, shared by the
 * inbox-side repository (P7-NOTIF-01) and the delivery-side repository
 * (P7-NOTIF-02) so the two cannot drift. `jsonb` columns are written
 * exclusively by this module's own policy and round-trip already parsed —
 * the narrowing casts state that ownership.
 */

import type { Selectable } from 'kysely';
import type {
  NotificationDeepLink,
  NotificationIntent,
  NotificationIntentState,
  NotificationPriority,
} from '../domain/notification-intent.js';
import type { NotificationIntentRow } from './schema.js';

export function toIntent(row: Selectable<NotificationIntentRow>): NotificationIntent {
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
    templateParameters: row.template_parameters as Readonly<Record<string, unknown>>,
    priority: row.priority as NotificationPriority,
    channelInApp: row.channel_in_app,
    channelPush: row.channel_push,
    deepLink: row.deep_link as NotificationDeepLink,
    dedupKey: row.dedup_key,
    earliestDeliveryAt: row.earliest_delivery_at,
    expiresAt: row.expires_at,
    state: row.state as NotificationIntentState,
    closeReason: row.close_reason,
    nextDeliveryAttemptAt: row.next_delivery_attempt_at,
    deliveryAttemptCount: row.delivery_attempt_count,
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
