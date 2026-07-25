/**
 * `RunNotificationDeliverySweep` (P7-NOTIF-02): the periodic pass that
 * turns durable pending intents into FCM delivery attempts —
 * notifications.md section 5's `preference and freshness recheck -> FCM
 * delivery attempt` steps, plus the at-scale `pending -> expired` close
 * P7-NOTIF-01 explicitly deferred here.
 *
 * WHERE THIS RUNS, AND WHY: in `services/api`, triggered by the
 * OIDC-verified internal endpoint the worker's interval scheduler calls —
 * the established sweep shape (`run-recommendation-evaluation-sweep.ts`),
 * same privilege reasoning: the rechecks read membership, preferences,
 * candidates, and device tokens, all data `verdery_worker` deliberately
 * cannot touch; the worker contributes only its schedule and verified
 * identity. The interval tick stands in for per-intent Cloud Task
 * scheduling: `earliest_delivery_at` is minute-granular (quiet-hours
 * ends), so a minute-order tick claiming the due set delivers within the
 * same precision a per-intent task would, without a second scheduling
 * system to keep consistent (deferred-capabilities.md records the
 * possible refinement).
 *
 * PER CLAIMED INTENT, in order:
 * 1. one read transaction gathers the CURRENT facts (membership,
 *    candidate, preferences, active devices);
 * 2. `decideSendTimeAction` — the pure send-time recheck (section 9);
 * 3. a non-send decision writes its outcome state-conditionally and moves
 *    on;
 * 4. a send runs OUTSIDE any transaction (provider calls never hold a
 *    connection), one attempt per active device;
 * 5. one outcome transaction binds the append-only attempt records, the
 *    idempotent invalid-token device disables (section 6), and the
 *    intent's own transition — sent when ANY device accepted, a bounded
 *    backoff retry when the best outcome was transient, failed otherwise.
 *
 * FAILURE ISOLATION: every provider outcome is a classified value, so one
 * intent's permanent failure or dead token never throws and never poisons
 * the batch (section 13); a concurrent content close (supersession racing
 * the send) makes the outcome write a counted lost race. Unexpected
 * errors — a defect, not a delivery outcome — still propagate and fail
 * the run loudly, the sibling sweeps' posture.
 */

import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  buildPushMessageData,
  decideSendTimeAction,
  resolveTransientRetryAt,
} from '../domain/notification-delivery.js';
import type { SendTimeDecision, SendTimeFacts } from '../domain/notification-delivery.js';
import { DEVICE_DISABLED_REASON_TOKEN_INVALID } from '../domain/notification-device.js';
import type { NotificationDevice } from '../domain/notification-device.js';
import type { NotificationIntent } from '../domain/notification-intent.js';
import type { NewDeliveryAttempt } from './notification-delivery-repository.js';
import type { PushMessageSender, PushSendOutcome } from './push-message-sender.js';
import type { NotificationsUnitOfWork } from './notifications-unit-of-work.js';

/**
 * Intents claimed per run — each fans out to reads and provider calls, so
 * the bounded-batch posture of the sibling sweeps applies (their reasoned
 * 25). Natural drainage holds: a processed intent leaves the due set.
 */
export const DELIVERY_SWEEP_CLAIM_LIMIT = 25;

/**
 * Past-expiry pending intents closed per run. Far cheaper than a claim
 * (one bulk state flip, no fan-out), so the bound is wider; 500 keeps the
 * statement small while draining any realistic backlog within a few
 * minute-order ticks.
 */
export const DELIVERY_SWEEP_EXPIRY_LIMIT = 500;

/**
 * How long a claim lease lasts. A batch of 25 completes in seconds; five
 * minutes means a crashed run's claims resurface on a near-future tick
 * without letting a slow provider call double-send against itself.
 */
export const DELIVERY_CLAIM_LEASE_MS = 5 * 60_000;

/**
 * Why an intent transitioned to `failed` — `intentsFailed`'s closed key
 * vocabulary, exported so the analytics catalog
 * (`tests/analytics/care-loop-analytics.test.ts`) pins it at compile time
 * (P7-ANALYTICS-01): a new failure reason cannot ship without passing the
 * consent-boundary review that test encodes.
 */
export type DeliveryFailReason =
  'retry_budget_exhausted' | 'provider_permanent_failure' | 'all_tokens_invalid';

export interface NotificationDeliverySweepResult {
  /** Past-expiry pending intents closed by this run's expiry phase. */
  readonly intentsExpired: number;
  /** Due intents this run claimed for processing. */
  readonly intentsClaimed: number;
  /** Intents transitioned to `sent` (at least one device accepted). */
  readonly intentsSent: number;
  /** Send-time recheck skips, by typed reason. */
  readonly intentsSkipped: Readonly<Record<string, number>>;
  /** Intents transitioned to `failed`, by typed reason. */
  readonly intentsFailed: Readonly<Record<string, number>>;
  /** Quiet-hours deferrals (the window moved since intent creation). */
  readonly intentsDeferred: number;
  /** Bounded transient-retry reschedules. */
  readonly retriesScheduled: number;
  /** Device-level provider outcomes, by classification. */
  readonly attemptOutcomes: Readonly<Record<string, number>>;
  /** Device channels disabled after an invalid-token verdict. */
  readonly devicesDisabled: number;
  /** Outcome writes that found the intent already closed by a concurrent writer. */
  readonly lostRaces: number;
}

interface DeviceSendOutcome {
  readonly device: NotificationDevice;
  readonly outcome: PushSendOutcome;
}

/** The in-progress run's counters — the result type minus the claim count, mutable while the batch drains. */
interface MutableSweepSummary {
  intentsExpired: number;
  intentsSent: number;
  intentsSkipped: Record<string, number>;
  intentsFailed: Record<string, number>;
  intentsDeferred: number;
  retriesScheduled: number;
  attemptOutcomes: Record<string, number>;
  devicesDisabled: number;
  lostRaces: number;
}

function count(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export class RunNotificationDeliverySweep {
  constructor(
    private readonly unitOfWork: NotificationsUnitOfWork,
    private readonly pushMessageSender: PushMessageSender,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<NotificationDeliverySweepResult> {
    const now = this.clock.now();

    // Expiry first, so a lapsed intent is closed instead of claimed — the
    // evaluation sweep's own phase-ordering reasoning.
    const intentsExpired = await this.unitOfWork.run((context) =>
      context.delivery.expireDuePending(now, DELIVERY_SWEEP_EXPIRY_LIMIT),
    );

    const leaseUntil = new Date(now.getTime() + DELIVERY_CLAIM_LEASE_MS);
    const claimed = await this.unitOfWork.run((context) =>
      context.delivery.claimDueForDelivery(now, leaseUntil, DELIVERY_SWEEP_CLAIM_LIMIT),
    );

    const summary: MutableSweepSummary = {
      intentsExpired,
      intentsSent: 0,
      intentsSkipped: {},
      intentsFailed: {},
      intentsDeferred: 0,
      retriesScheduled: 0,
      attemptOutcomes: {},
      devicesDisabled: 0,
      lostRaces: 0,
    };

    for (const intent of claimed) {
      await this.processIntent(intent, summary);
    }

    return { intentsClaimed: claimed.length, ...summary };
  }

  private async processIntent(
    intent: NotificationIntent,
    summary: MutableSweepSummary,
  ): Promise<void> {
    // One transaction for the recheck facts: the decision must run against
    // a consistent snapshot (the ApplyNotificationPolicy rule).
    const { facts, devices } = await this.unitOfWork.run(async (context) => {
      // An account-level intent (garden_id null, P8-EXPORT-01) has no
      // membership to recheck — the recipient facts are the profile's own.
      // Unreachable today (export intents pin `channelPush` false, and the
      // claim reads only push-eligible rows), but the sweep stays total
      // over the intent shape the schema now allows.
      const recipient =
        intent.gardenId === null
          ? await context.recipients.findProfileRecipient(intent.recipientProfileId)
          : await context.recipients.findActiveMember(intent.gardenId, intent.recipientProfileId);
      const candidate =
        intent.recommendationCandidateId === null
          ? null
          : await context.recommendationFreshness.findCandidate(intent.recommendationCandidateId);
      const settings = await context.preferences.getSettings(intent.recipientProfileId);
      const preferenceEntries = await context.preferences.listEntries(intent.recipientProfileId);
      const activeDevices = await context.devices.listActiveForProfile(intent.recipientProfileId);

      const gatheredFacts: SendTimeFacts = {
        intent,
        recipient,
        candidate,
        preferenceEntries,
        settings,
        hasActiveDevice: activeDevices.length > 0,
      };
      return { facts: gatheredFacts, devices: activeDevices };
    });

    const decisionAt = this.clock.now();
    const decision = decideSendTimeAction(facts, decisionAt);

    if (decision.kind !== 'send') {
      await this.writeNonSendOutcome(intent, decision, decisionAt, summary);
      return;
    }

    // Provider calls outside any transaction — the established posture.
    const data = buildPushMessageData(intent);
    const outcomes: DeviceSendOutcome[] = [];
    for (const device of devices) {
      const outcome = await this.pushMessageSender.send({
        token: device.fcmToken,
        priority: intent.priority,
        data,
      });
      count(summary.attemptOutcomes, outcome.kind);
      outcomes.push({ device, outcome });
    }

    await this.writeSendOutcome(intent, outcomes, summary);
  }

  private async writeNonSendOutcome(
    intent: NotificationIntent,
    decision: Exclude<SendTimeDecision, { kind: 'send' }>,
    now: Date,
    summary: MutableSweepSummary,
  ): Promise<void> {
    const written = await this.unitOfWork.run((context) => {
      switch (decision.kind) {
        case 'expire':
          return context.delivery.closeDelivery(intent.id, 'expired', null, now);
        case 'skip':
          return context.delivery.closeDelivery(intent.id, 'skipped', decision.reason, now);
        case 'defer':
          // A deferral consumes no attempt round — no send happened.
          return context.delivery.scheduleRetry(
            intent.id,
            decision.nextAttemptAt,
            intent.deliveryAttemptCount,
            now,
          );
      }
    });

    if (!written) {
      summary.lostRaces += 1;
      return;
    }
    if (decision.kind === 'defer') {
      summary.intentsDeferred += 1;
    } else if (decision.kind === 'skip') {
      count(summary.intentsSkipped, decision.reason);
    } else {
      // A recheck-time expire close IS an expiry, observed a moment after
      // the phase ran — counted in the same metric.
      summary.intentsExpired += 1;
    }
  }

  private async writeSendOutcome(
    intent: NotificationIntent,
    outcomes: readonly DeviceSendOutcome[],
    summary: MutableSweepSummary,
  ): Promise<void> {
    const now = this.clock.now();
    const attemptCount = intent.deliveryAttemptCount + 1;

    const attempts: NewDeliveryAttempt[] = outcomes.map(({ device, outcome }) => ({
      id: generateUuidV7(),
      intentId: intent.id,
      deviceId: device.id,
      outcome: outcome.kind,
      errorCode: outcome.kind === 'accepted' ? null : outcome.errorCode,
      attemptedAt: now,
    }));

    const anyAccepted = outcomes.some(({ outcome }) => outcome.kind === 'accepted');
    const anyTransient = outcomes.some(({ outcome }) => outcome.kind === 'transient_failure');
    const anyPermanent = outcomes.some(({ outcome }) => outcome.kind === 'permanent_failure');

    // One transaction: the attempt records, the invalid-token disables,
    // and the intent's own outcome commit together — a crash leaves either
    // the pre-attempt world (the lease re-delivers) or the complete one.
    const result = await this.unitOfWork.run(async (context) => {
      await context.delivery.recordAttempts(attempts);

      let devicesDisabled = 0;
      for (const { device, outcome } of outcomes) {
        if (outcome.kind === 'token_invalid') {
          const disabled = await context.devices.disable(
            device.id,
            DEVICE_DISABLED_REASON_TOKEN_INVALID,
            now,
          );
          if (disabled) {
            devicesDisabled += 1;
          }
        }
      }

      if (anyAccepted) {
        const written = await context.delivery.markSent(intent.id, attemptCount, now);
        return { devicesDisabled, written, outcome: 'sent' as const, failReason: null };
      }

      if (anyTransient) {
        const retryAt = resolveTransientRetryAt(attemptCount, now);
        if (retryAt !== null) {
          const written = await context.delivery.scheduleRetry(
            intent.id,
            retryAt,
            attemptCount,
            now,
          );
          return { devicesDisabled, written, outcome: 'retry' as const, failReason: null };
        }
        const written = await context.delivery.closeDelivery(
          intent.id,
          'failed',
          'retry_budget_exhausted',
          now,
        );
        return {
          devicesDisabled,
          written,
          outcome: 'failed' as const,
          failReason: 'retry_budget_exhausted' satisfies DeliveryFailReason,
        };
      }

      // No acceptance, nothing worth retrying: a permanent provider
      // failure, or every token dead (each already disabled above).
      const failReason: DeliveryFailReason = anyPermanent
        ? 'provider_permanent_failure'
        : 'all_tokens_invalid';
      const written = await context.delivery.closeDelivery(intent.id, 'failed', failReason, now);
      return { devicesDisabled, written, outcome: 'failed' as const, failReason };
    });

    summary.devicesDisabled += result.devicesDisabled;
    if (!result.written) {
      summary.lostRaces += 1;
      return;
    }
    if (result.outcome === 'sent') {
      summary.intentsSent += 1;
    } else if (result.outcome === 'retry') {
      summary.retriesScheduled += 1;
    } else if (result.failReason !== null) {
      count(summary.intentsFailed, result.failReason);
    }
  }
}
