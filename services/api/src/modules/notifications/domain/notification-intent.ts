/**
 * The notification intent entity and its lifecycle (P7-NOTIF-01, completed
 * by P7-NOTIF-02).
 *
 * One durable intent per recipient — notifications.md section 4's field
 * list. The intent doubles as the in-app inbox record (section 12): the
 * delivery-lifecycle `state` and the inbox view state (`readAt`/
 * `dismissedAt`) are deliberately separate facts, because "Push delivery
 * success does not determine inbox state" and a user may read an entry
 * whose delivery lifecycle has since closed.
 *
 * STATE MACHINE — P7-NOTIF-01's creation-side closes plus the
 * delivery-outcome vocabulary P7-NOTIF-02's worker is the first code to
 * reach:
 *
 * ```text
 * (policy creates) → pending ──→ superseded   a newer candidate's intent
 *                        │                    replaced it before delivery
 *                        ├─────→ expired      closed without delivery after
 *                        │                    expires_at (section 13)
 *                        ├─────→ sent         the provider accepted at least
 *                        │                    one device send (acceptance,
 *                        │                    not confirmed display)
 *                        ├─────→ failed       permanent provider failure,
 *                        │                    exhausted retry budget, or no
 *                        │                    deliverable device
 *                        └─────→ skipped      a send-time recheck said not
 *                                             to send (typed `closeReason`)
 * ```
 *
 * Every non-pending state is terminal. The two GROUPS matter for the
 * inbox: `superseded`/`expired` are CONTENT-lifecycle closes and leave the
 * inbox; `sent`/`failed`/`skipped` are DELIVERY outcomes and stay listed
 * until expiration — "In-app inbox remains correct when FCM fails"
 * (section 17). Supersession closes only PENDING intents (Stage 23's
 * explicit rule): a delivered entry is history the newer entry sits beside.
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type NotificationIntentState =
  'pending' | 'superseded' | 'expired' | 'sent' | 'failed' | 'skipped';

export type NotificationPriority = 'normal' | 'high';

/** Stable route reference plus resource ids, never bearer access (notifications.md section 11). */
export interface GardenTodayDeepLink {
  readonly kind: 'gardenToday';
  readonly gardenId: Uuid;
  readonly recommendationCandidateId: Uuid;
}

/** P8-EXPORT-01: the recipient's own completed export request — state and, while unexpired, its download. */
export interface ExportReadyDeepLink {
  readonly kind: 'exportReady';
  readonly exportRequestId: Uuid;
}

export type NotificationDeepLink = GardenTodayDeepLink | ExportReadyDeepLink;

export interface NotificationIntent {
  readonly id: Uuid;
  readonly intentType: string;
  readonly intentVersion: number;
  readonly recipientProfileId: Uuid;
  /**
   * The garden this intent concerns — `null` for account-level intents
   * (P8-EXPORT-01: an `export_ready` entry for an account-wide export
   * concerns no garden). `care_recommendation` intents always carry one,
   * pinned by the migration's `notification_intent_garden_linkage_check`.
   */
  readonly gardenId: Uuid | null;
  /** The freshness linkage: which recommendation this intent is about, so send-time rechecks can classify it stale. `null` only for future non-recommendation types. */
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
  readonly state: NotificationIntentState;
  /** Typed reason for a `failed`/`skipped` delivery close (P7-NOTIF-02); `null` in every other state. */
  readonly closeReason: string | null;
  /**
   * The delivery worker's own scheduling column (P7-NOTIF-02), separate
   * from the policy's immutable `earliestDeliveryAt`: `null` until first
   * claimed, then the claim lease, a quiet-hours recheck deferral, or a
   * bounded transient-retry time.
   */
  readonly nextDeliveryAttemptAt: Date | null;
  /** How many FCM send rounds this intent has consumed — bounds transient retries (P7-NOTIF-02). */
  readonly deliveryAttemptCount: number;
  readonly readAt: Date | null;
  readonly dismissedAt: Date | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const LEGAL_TRANSITIONS: Readonly<
  Record<NotificationIntentState, readonly NotificationIntentState[]>
> = {
  pending: ['superseded', 'expired', 'sent', 'failed', 'skipped'],
  superseded: [],
  expired: [],
  sent: [],
  failed: [],
  skipped: [],
};

/**
 * The states an intent may occupy while still belonging in its recipient's
 * inbox: `pending` plus the three delivery outcomes — delivery success or
 * failure never removes the durable user-facing record (section 12), only
 * the content-lifecycle closes (`superseded`, `expired`) do.
 */
export const INBOX_VISIBLE_STATES: readonly NotificationIntentState[] = [
  'pending',
  'sent',
  'failed',
  'skipped',
];

/** Throws unless `from -> to` is a legal lifecycle edge — the guard every state-changing repository operation encodes as its `WHERE state = 'pending'` condition. */
export function validateIntentStateTransition(
  from: NotificationIntentState,
  to: NotificationIntentState,
): void {
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new DomainRuleViolatedError(
      'notification.intent.illegal_transition',
      `A notification intent cannot transition from '${from}' to '${to}'.`,
    );
  }
}

/**
 * Whether the intent belongs in its recipient's inbox LIST right now: in
 * an inbox-visible state (pending or any delivery outcome — see
 * `INBOX_VISIBLE_STATES`), eligible for the in-app channel, not dismissed,
 * and not past its expiration (section 12: the inbox "supports read state,
 * expiration, and source navigation" — a read entry stays listed; an
 * expired or dismissed one does not).
 */
export function isInboxVisible(intent: NotificationIntent, now: Date): boolean {
  return (
    INBOX_VISIBLE_STATES.includes(intent.state) &&
    intent.channelInApp &&
    intent.dismissedAt === null &&
    intent.expiresAt.getTime() > now.getTime()
  );
}
