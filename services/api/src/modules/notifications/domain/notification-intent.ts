/**
 * The notification intent entity and its lifecycle (P7-NOTIF-01).
 *
 * One durable intent per recipient — notifications.md section 4's field
 * list. The intent doubles as the in-app inbox record (section 12): the
 * delivery-lifecycle `state` and the inbox view state (`readAt`/
 * `dismissedAt`) are deliberately separate facts, because "Push delivery
 * success does not determine inbox state" and a user may read an entry
 * whose delivery lifecycle has since closed.
 *
 * STATE MACHINE — exactly the transitions this stage can reach:
 *
 * ```text
 * (policy creates) → pending ──→ superseded   a newer candidate's intent
 *                        │                    replaced it before delivery
 *                        └─────→ expired      closed without delivery after
 *                                             expires_at (section 13)
 * ```
 *
 * `superseded` and `expired` are terminal. Sent/failed vocabulary arrives
 * with P7-NOTIF-02's delivery worker — the first code that could reach it;
 * declaring it now would be untested dead states (the
 * `gardens_mapping.garden.lifecycle_state` posture).
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type NotificationIntentState = 'pending' | 'superseded' | 'expired';

export type NotificationPriority = 'normal' | 'high';

/** The one deep-link kind this stage produces — stable route reference plus resource ids, never bearer access (notifications.md section 11). */
export interface GardenTodayDeepLink {
  readonly kind: 'gardenToday';
  readonly gardenId: Uuid;
  readonly recommendationCandidateId: Uuid;
}

export type NotificationDeepLink = GardenTodayDeepLink;

export interface NotificationIntent {
  readonly id: Uuid;
  readonly intentType: string;
  readonly intentVersion: number;
  readonly recipientProfileId: Uuid;
  readonly gardenId: Uuid;
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
  readonly readAt: Date | null;
  readonly dismissedAt: Date | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const LEGAL_TRANSITIONS: Readonly<
  Record<NotificationIntentState, readonly NotificationIntentState[]>
> = {
  pending: ['superseded', 'expired'],
  superseded: [],
  expired: [],
};

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
 * Whether the intent belongs in its recipient's inbox LIST right now:
 * still pending, eligible for the in-app channel, not dismissed, and not
 * past its expiration (section 12: the inbox "supports read state,
 * expiration, and source navigation" — a read entry stays listed; an
 * expired or dismissed one does not).
 */
export function isInboxVisible(intent: NotificationIntent, now: Date): boolean {
  return (
    intent.state === 'pending' &&
    intent.channelInApp &&
    intent.dismissedAt === null &&
    intent.expiresAt.getTime() > now.getTime()
  );
}
