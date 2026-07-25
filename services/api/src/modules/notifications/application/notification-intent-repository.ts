/**
 * Port for the module's own `notifications.notification_intent` rows
 * (P7-NOTIF-01).
 *
 * Every state-changing operation encodes its legal lifecycle edge as a
 * state-conditional UPDATE (`WHERE state = 'pending'`) — the SQL form of
 * `validateIntentStateTransition` — so a concurrent close can never be
 * overwritten, and the inbox view writes (`markRead`/`markDismissed`) are
 * set-once COALESCE updates that converge under concurrency instead of
 * needing client revision guards.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NotificationDeepLink,
  NotificationIntent,
  NotificationPriority,
} from '../domain/notification-intent.js';

/** Everything the policy decides for a new intent; storage adds lifecycle defaults (`pending`, revision 1, timestamps). */
export interface NewNotificationIntent {
  readonly id: Uuid;
  readonly intentType: string;
  readonly intentVersion: number;
  readonly recipientProfileId: Uuid;
  readonly gardenId: Uuid;
  readonly recommendationCandidateId: Uuid | null;
  readonly sourceEventId: Uuid;
  readonly traceId: string | null;
  readonly templateKey: string;
  readonly templateParameters: Readonly<Record<string, unknown>>;
  readonly priority: NotificationPriority;
  readonly channelInApp: boolean;
  readonly channelPush: boolean;
  readonly deepLink: NotificationDeepLink;
  readonly dedupKey: string;
  readonly earliestDeliveryAt: Date;
  readonly expiresAt: Date;
}

export interface NotificationIntentRepository {
  /**
   * Inserts one intent unless the recipient already holds one under the
   * same deduplication key — `ON CONFLICT DO NOTHING` against the unique
   * `(recipient_profile_id, dedup_key)` index, notifications.md section
   * 10's "repeated event delivery must not create repeated user
   * notifications" made structural. Returns whether a row was created.
   */
  insertIfAbsent(intent: NewNotificationIntent, now: Date): Promise<boolean>;

  /**
   * Closes every still-pending intent about `candidateId` as `superseded`
   * — called when a newer candidate's event names it in
   * `supersedesCandidateId`. Returns how many rows transitioned.
   */
  closePendingForCandidate(candidateId: Uuid, now: Date): Promise<number>;

  /**
   * Closes the recipient's own past-expiry pending intents as `expired` —
   * the inbox read's read-triggers-write half (section 12 "supports ...
   * expiration"; section 13 "Expired ... intents close without
   * delivery"). Returns how many rows transitioned.
   */
  expirePendingForRecipient(recipientProfileId: Uuid, now: Date): Promise<number>;

  /**
   * One page of the recipient's live inbox entries — inbox-visible state
   * (`INBOX_VISIBLE_STATES`: pending plus the delivery outcomes), in-app
   * eligible, not dismissed, not past expiration — newest first by id
   * (UUIDv7 time ordering), strictly before `beforeId` when given. The
   * expiry filter is explicit here since P7-NOTIF-02: a `sent` entry keeps
   * its delivery truth forever, so lapsing out of the inbox is a
   * view-time fact of `expiresAt`, not a state transition.
   */
  listInboxPage(
    recipientProfileId: Uuid,
    beforeId: Uuid | null,
    limit: number,
    now: Date,
  ): Promise<readonly NotificationIntent[]>;

  /** The recipient's own intent, or `null` — never another recipient's (the not-found concealment boundary). */
  findForRecipient(id: Uuid, recipientProfileId: Uuid): Promise<NotificationIntent | null>;

  /** Sets `readAt` once (later calls keep the first stamp); `null` when the id is not the recipient's. */
  markRead(id: Uuid, recipientProfileId: Uuid, now: Date): Promise<NotificationIntent | null>;

  /** Sets `dismissedAt` once (later calls keep the first stamp); `null` when the id is not the recipient's. */
  markDismissed(id: Uuid, recipientProfileId: Uuid, now: Date): Promise<NotificationIntent | null>;
}
