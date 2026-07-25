/**
 * Send-time delivery decisions (P7-NOTIF-02) — notifications.md section
 * 9's recheck list as one pure function, run by the delivery sweep against
 * facts read in the same transaction, immediately before any FCM attempt:
 *
 * - Expiration ("Expired or stale intents close without delivery").
 * - Recipient access (section 14: "Shared-garden role changes are
 *   rechecked at send time") — the recipient must still be an ACTIVE
 *   member of the garden with a usable account.
 * - Recommendation freshness — `assessCareRecommendationEvent`, the SAME
 *   classification the policy ran at creation time (Stage 23 shipped it
 *   for exactly this re-run): a candidate that has since been acted on,
 *   superseded, or window-lapsed skips with its typed reason.
 * - Notification preference — the CURRENT channel resolution; push
 *   disabled since creation skips.
 * - Quiet hours — the CURRENT window; a window that moved over `now`
 *   since creation defers to its end, never skips (deferral is scheduling,
 *   not suppression).
 * - Device availability — no active device is a terminal skip: most
 *   accounts have no push installation at all, and re-claiming their
 *   intents every sweep until expiry would be permanent busywork; a device
 *   registered later is served by the NEXT intent.
 *
 * ORDER: terminal classifications run before the quiet-hours deferral so a
 * doomed intent (stale, inaccessible, opted out) closes now instead of
 * being kept alive to fail after the window.
 *
 * Also here, pure: the push payload (identifiers only — section 8's
 * lock-screen privacy: rendering happens on the client in the recipient's
 * locale; no plant names, no garden names, no rendered text) and the
 * bounded transient-retry policy (section 13: "Transient errors retry
 * within intent expiration" — expiration bounds the window, this policy
 * bounds the attempts).
 */

import type { AccountState } from '../../identity-access/public.js';
import { isAccountUsable } from '../../identity-access/public.js';
import type { NotificationIntent } from './notification-intent.js';
import type { CandidateFreshnessFacts, EventSuppressionReason } from './notification-policy.js';
import { assessCareRecommendationEvent } from './notification-policy.js';
import { CARE_RECOMMENDATION_INTENT_TYPE } from './notification-preference.js';
import type {
  NotificationPreferenceEntry,
  NotificationPreferenceSettings,
} from './notification-preference.js';
import { resolveChannelPreference } from './notification-preference.js';
import { isWithinQuietHours, resolveEarliestDeliveryAt } from './quiet-hours.js';

/**
 * Maximum FCM send rounds one intent may consume. No document names a
 * number, so this is a reasoned default in the established "pick one and
 * say so" posture: with the backoff below, five rounds span roughly an
 * hour and a quarter of provider trouble — beyond that the recommendation
 * nudge is close enough to its next sweep-minted successor that giving up
 * beats hammering.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** First transient-retry delay; each further round doubles it (5, 10, 20, 40 minutes). */
export const DELIVERY_RETRY_BASE_DELAY_MS = 5 * 60_000;

export type SendTimeSkipReason =
  | 'recipient_access_revoked'
  | 'account_not_usable'
  | 'push_channel_disabled'
  | 'no_active_device'
  | EventSuppressionReason;

export type SendTimeDecision =
  | { readonly kind: 'send' }
  | { readonly kind: 'defer'; readonly nextAttemptAt: Date }
  | { readonly kind: 'expire' }
  | { readonly kind: 'skip'; readonly reason: SendTimeSkipReason };

/** The recipient facts the recheck consumes — the domain's own input shape (the `RecipientPolicyInput` precedent); `GardenRecipient` satisfies it structurally. */
export interface SendTimeRecipientFacts {
  readonly accountState: AccountState;
  /** The profile's own IANA zone — the quiet-hours default when no preference override exists. */
  readonly timeZone: string;
}

export interface SendTimeFacts {
  readonly intent: NotificationIntent;
  /** The recipient's CURRENT active membership on the intent's garden, or `null` when none exists any more. */
  readonly recipient: SendTimeRecipientFacts | null;
  /** The candidate's CURRENT lifecycle facts; `null` when the row is gone. Ignored for non-recommendation intent types. */
  readonly candidate: CandidateFreshnessFacts | null;
  readonly preferenceEntries: readonly NotificationPreferenceEntry[];
  readonly settings: NotificationPreferenceSettings;
  readonly hasActiveDevice: boolean;
}

export function decideSendTimeAction(facts: SendTimeFacts, now: Date): SendTimeDecision {
  const { intent, recipient } = facts;

  if (intent.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'expire' };
  }

  if (recipient === null) {
    return { kind: 'skip', reason: 'recipient_access_revoked' };
  }
  if (!isAccountUsable(recipient.accountState)) {
    return { kind: 'skip', reason: 'account_not_usable' };
  }

  if (intent.intentType === CARE_RECOMMENDATION_INTENT_TYPE) {
    const assessment = assessCareRecommendationEvent(facts.candidate, now);
    if (assessment.kind === 'suppress') {
      return { kind: 'skip', reason: assessment.reason };
    }
  }

  const channels = resolveChannelPreference(
    facts.preferenceEntries,
    intent.intentType,
    intent.gardenId,
  );
  if (!channels.pushEnabled) {
    return { kind: 'skip', reason: 'push_channel_disabled' };
  }

  const zone = facts.settings.quietHoursTimeZone ?? recipient.timeZone;
  if (
    facts.settings.quietHours !== null &&
    isWithinQuietHours(now, facts.settings.quietHours, zone)
  ) {
    return {
      kind: 'defer',
      nextAttemptAt: resolveEarliestDeliveryAt(now, facts.settings.quietHours, zone),
    };
  }

  if (!facts.hasActiveDevice) {
    return { kind: 'skip', reason: 'no_active_device' };
  }

  return { kind: 'send' };
}

/**
 * The FCM data payload: stable identifiers and the rendering key only —
 * the client authenticates, resolves the deep link to its own navigation
 * (section 11), and renders in its own locale (section 8). Values are all
 * strings because FCM's data map is string-to-string. Deliberately NO
 * template parameters and NO rendered text: nothing here may reveal
 * private garden details on a lock screen, and nothing here acts as
 * authorization.
 */
export function buildPushMessageData(intent: NotificationIntent): Readonly<Record<string, string>> {
  return {
    notificationId: intent.id,
    notificationType: intent.intentType,
    templateKey: intent.templateKey,
    deepLinkKind: intent.deepLink.kind,
    gardenId: intent.deepLink.gardenId,
    recommendationCandidateId: intent.deepLink.recommendationCandidateId,
  };
}

/**
 * When the NEXT send round may run after a transient provider failure, or
 * `null` when `attemptCount` rounds have exhausted the budget — see the
 * header. `attemptCount` counts rounds already consumed, this one
 * included. Expiration bounds the calendar window separately: a retry
 * scheduled past `expiresAt` is simply never claimed and the sweep's
 * expiry phase closes the intent.
 */
export function resolveTransientRetryAt(attemptCount: number, now: Date): Date | null {
  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return null;
  }
  const delayMs = DELIVERY_RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1);
  return new Date(now.getTime() + delayMs);
}
