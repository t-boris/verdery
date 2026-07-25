/**
 * The notification policy (P7-NOTIF-01) — notifications.md section 5's
 * "notification policy" step as pure decisions: given a domain event's
 * facts, the candidate's CURRENT state, the recipients, and each
 * recipient's preferences, decide per recipient whether a durable intent
 * exists and with which channel eligibility, delivery earliest-time,
 * expiry, deduplication key, template, priority, and deep link.
 *
 * Everything here is deterministic and side-effect free; the application
 * layer (`ApplyNotificationPolicy`) supplies the reads and persists the
 * outcomes. That split is what makes the acceptance evidence —
 * "Notification policy tests" — direct unit tests over every decision
 * rather than assertions about database plumbing.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AccountState } from '../../identity-access/public.js';
import { isAccountUsable } from '../../identity-access/public.js';
import type { NotificationDeepLink, NotificationPriority } from './notification-intent.js';
import type { ChannelPreference } from './notification-preference.js';
import { CARE_RECOMMENDATION_INTENT_TYPE } from './notification-preference.js';
import type { QuietHours } from './quiet-hours.js';
import { resolveEarliestDeliveryAt } from './quiet-hours.js';

/** Versioned with the intent type ("Type and version", section 4): a payload-shape change bumps it so late renderers know what they hold. */
export const CARE_RECOMMENDATION_INTENT_VERSION = 1;

/** Stable rendering key ("Stable template key and structured parameters", section 4); clients render it in the recipient's locale as late as practical (section 8). */
export const CARE_RECOMMENDATION_TEMPLATE_KEY = 'care_recommendation.created.v1';

/**
 * How long a care-recommendation intent stays deliverable when its
 * candidate declares NO validity-window end. Where the candidate has one,
 * that window end IS the expiry (section 4's "expiration" tied to the
 * recommendation's own validity). No document names a fallback number, so
 * this is a reasoned default in the established "pick one and say so"
 * posture: the evaluation sweep re-examines every garden four times a day
 * and re-fires still-relevant rules through supersession, so a week-old
 * undelivered nudge with no deadline of its own is noise, not care.
 */
export const CARE_RECOMMENDATION_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The purpose-specific deduplication key (section 10's own example is
 * "recommendation ID plus reminder window"): for candidate-created intents
 * the reminder window IS the candidate's own validity window, so the
 * candidate id — one per (rule, target, window) instance by the engine's
 * construction, with recurrence and re-surfacing minting NEW candidates
 * deliberately — carries both halves. Unique per recipient in storage, so
 * repeated event delivery collapses instead of repeating notifications.
 */
export function buildCareRecommendationDedupKey(candidateId: Uuid): string {
  return `${CARE_RECOMMENDATION_INTENT_TYPE}:candidate:${candidateId}`;
}

/** Two transport priorities from four urgencies: `urgent`/`high` warrant waking a device, the rest do not. */
export function derivePriorityFromUrgency(urgency: string): NotificationPriority {
  return urgency === 'urgent' || urgency === 'high' ? 'high' : 'normal';
}

/** The stable route reference the client resolves after authenticating (section 11) — the Today surface is the care loop's home. */
export function buildCareRecommendationDeepLink(
  gardenId: Uuid,
  candidateId: Uuid,
): NotificationDeepLink {
  return { kind: 'gardenToday', gardenId, recommendationCandidateId: candidateId };
}

/** P8-EXPORT-01 — versioned with the intent type, the care-recommendation precedent. */
export const EXPORT_READY_INTENT_VERSION = 1;

/** P8-EXPORT-01 — stable rendering key; clients render "your export is ready until <expiry>" in their own locale. */
export const EXPORT_READY_TEMPLATE_KEY = 'export_ready.completed.v1';

/**
 * P8-EXPORT-01: one export request completes exactly once, so the request
 * id alone is the whole deduplication story — a redelivered
 * `export.completed` event collapses per recipient exactly like a
 * redelivered candidate event does.
 */
export function buildExportReadyDedupKey(exportRequestId: Uuid): string {
  return `export_ready:request:${exportRequestId}`;
}

/** P8-EXPORT-01: the stable route reference to the recipient's own export request (section 11's identifiers-only rule — never the signed URL itself, which is minted per download). */
export function buildExportReadyDeepLink(exportRequestId: Uuid): NotificationDeepLink {
  return { kind: 'exportReady', exportRequestId };
}

/** The candidate's CURRENT lifecycle facts, read in the same transaction that persists intents — `null` when no row exists (purged). */
export interface CandidateFreshnessFacts {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly state: string;
  readonly windowEnd: Date | null;
}

export type EventSuppressionReason =
  'candidate_missing' | 'candidate_not_live' | 'candidate_window_passed';

export type CareRecommendationEventAssessment =
  | { readonly kind: 'actionable'; readonly expiresAt: Date }
  | { readonly kind: 'suppress'; readonly reason: EventSuppressionReason };

/** Candidate states a notification may still usefully point at: generated-and-eligible, or already presented but still live. */
const LIVE_CANDIDATE_STATES: readonly string[] = ['eligible', 'presented'];

/**
 * Event-level freshness: a `candidate_created` event drained late (the
 * relay's durable backlog is explicitly allowed to age —
 * deferred-capabilities.md's own entry) must not notify about a
 * recommendation that no longer stands. The same classification the
 * send-time recheck applies again before any push (section 9).
 */
export function assessCareRecommendationEvent(
  candidate: CandidateFreshnessFacts | null,
  now: Date,
): CareRecommendationEventAssessment {
  if (candidate === null) {
    return { kind: 'suppress', reason: 'candidate_missing' };
  }
  if (!LIVE_CANDIDATE_STATES.includes(candidate.state)) {
    return { kind: 'suppress', reason: 'candidate_not_live' };
  }
  if (candidate.windowEnd !== null && candidate.windowEnd.getTime() <= now.getTime()) {
    return { kind: 'suppress', reason: 'candidate_window_passed' };
  }

  return {
    kind: 'actionable',
    expiresAt: candidate.windowEnd ?? new Date(now.getTime() + CARE_RECOMMENDATION_DEFAULT_TTL_MS),
  };
}

/** Everything the per-recipient decision needs, already resolved by the caller. */
export interface RecipientPolicyInput {
  readonly profileId: Uuid;
  readonly accountState: AccountState;
  /** The profile's own IANA zone (`identity_access.profile.time_zone`). */
  readonly profileTimeZone: string;
  readonly channels: ChannelPreference;
  readonly quietHours: QuietHours | null;
  /** The preference document's zone override; `null` means the profile zone applies (section 7 lists time zone as a preference). */
  readonly quietHoursTimeZone: string | null;
}

export type RecipientSuppressionReason = 'account_not_usable' | 'channels_disabled';

export type RecipientPolicyDecision =
  | {
      readonly kind: 'create';
      readonly channelInApp: boolean;
      readonly channelPush: boolean;
      /** When push delivery may first be attempted — quiet hours deferred, in the recipient's zone. Never delays the in-app inbox entry. */
      readonly earliestDeliveryAt: Date;
    }
  | { readonly kind: 'suppress'; readonly reason: RecipientSuppressionReason };

/**
 * The per-recipient half of the policy: recipient selection has already
 * happened (active garden members — the application layer's read); this
 * decides whether THIS member gets a durable intent and how it may be
 * delivered.
 *
 * Quiet hours defer only the push attempt: with push disabled the intent
 * is in-app-only and `earliestDeliveryAt` is simply `now`. A quiet-hours
 * deferral may legitimately land past the intent's expiry — the delivery
 * worker then closes it expired without a push, which is the honest
 * outcome for "generated deep inside the do-not-disturb window of its own
 * short validity".
 */
export function evaluateRecipientPolicy(
  input: RecipientPolicyInput,
  now: Date,
): RecipientPolicyDecision {
  if (!isAccountUsable(input.accountState)) {
    return { kind: 'suppress', reason: 'account_not_usable' };
  }

  const { inAppEnabled, pushEnabled } = input.channels;
  if (!inAppEnabled && !pushEnabled) {
    return { kind: 'suppress', reason: 'channels_disabled' };
  }

  const earliestDeliveryAt = pushEnabled
    ? resolveEarliestDeliveryAt(
        now,
        input.quietHours,
        input.quietHoursTimeZone ?? input.profileTimeZone,
      )
    : now;

  return {
    kind: 'create',
    channelInApp: inAppEnabled,
    channelPush: pushEnabled,
    earliestDeliveryAt,
  };
}
