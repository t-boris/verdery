/**
 * `RunNotificationDeliverySweep` over the module fakes (P7-NOTIF-02): the
 * claim predicate, the send-time rechecks against CURRENT facts, the FCM
 * fan-out per device, and the failure taxonomy — invalid-token disabling
 * (the work package's named acceptance evidence), bounded transient
 * retries, permanent failures that never poison the batch, and the
 * at-scale expiry close P7-NOTIF-01 deferred here.
 */

import { describe, expect, it } from 'vitest';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import { MAX_DELIVERY_ATTEMPTS } from '../domain/notification-delivery.js';
import type { NewNotificationIntent } from './notification-intent-repository.js';
import {
  createNotificationsFakes,
  FakeNotificationsUnitOfWork,
  FakePushMessageSender,
  fixedClock,
} from './notification-test-doubles.js';
import type { NotificationsFakes } from './notification-test-doubles.js';
import {
  DELIVERY_CLAIM_LEASE_MS,
  RunNotificationDeliverySweep,
} from './run-notification-delivery-sweep.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const GARDEN_ID = '01890000-0000-7000-8000-00000000aaaa';
const PROFILE_ID = '01890000-0000-7000-8000-00000000bbbb';

interface Harness {
  readonly fakes: NotificationsFakes;
  readonly sender: FakePushMessageSender;
  readonly sweep: RunNotificationDeliverySweep;
}

function createHarness(at: Date = NOW): Harness {
  const fakes = createNotificationsFakes();
  const sender = new FakePushMessageSender();
  const sweep = new RunNotificationDeliverySweep(
    new FakeNotificationsUnitOfWork(fakes),
    sender,
    fixedClock(at),
  );
  return { fakes, sender, sweep };
}

interface SeedOptions {
  readonly candidateState?: string;
  readonly memberOfGarden?: boolean;
  readonly deviceTokens?: readonly string[];
  readonly intent?: Partial<NewNotificationIntent>;
  /** Defaults to the shared PROFILE_ID; distinct profiles isolate device sets. */
  readonly profileId?: Uuid;
}

/** Seeds one deliverable world: an active member with devices, a live candidate, and one due pending push intent. Returns the intent id. */
async function seedDeliverableIntent(harness: Harness, options: SeedOptions = {}): Promise<Uuid> {
  const candidateId = generateUuidV7();
  const intentId = generateUuidV7();
  const profileId = options.profileId ?? PROFILE_ID;

  if (options.memberOfGarden !== false) {
    const existing = harness.fakes.recipients.recipientsByGarden.get(GARDEN_ID) ?? [];
    if (!existing.some((recipient) => recipient.profileId === profileId)) {
      harness.fakes.recipients.recipientsByGarden.set(GARDEN_ID, [
        ...existing,
        { profileId, accountState: 'active', timeZone: 'UTC' },
      ]);
    }
  }
  harness.fakes.recommendationFreshness.candidates.set(candidateId, {
    id: candidateId,
    gardenId: GARDEN_ID,
    state: options.candidateState ?? 'presented',
    windowEnd: new Date('2026-07-27T12:00:00Z'),
  });
  for (const token of options.deviceTokens ?? ['token-1']) {
    await harness.fakes.devices.registerOrRefresh(
      {
        id: generateUuidV7(),
        profileId,
        installationId: generateUuidV7(),
        platform: 'ios',
        provider: 'fcm',
        fcmToken: token,
        environment: 'development',
      },
      new Date('2026-07-19T00:00:00Z'),
    );
  }

  await harness.fakes.intents.insertIfAbsent(
    {
      id: intentId,
      intentType: 'care_recommendation',
      intentVersion: 1,
      recipientProfileId: profileId,
      gardenId: GARDEN_ID,
      recommendationCandidateId: candidateId,
      sourceEventId: generateUuidV7(),
      traceId: null,
      templateKey: 'care_recommendation.created.v1',
      templateParameters: {},
      priority: 'high',
      channelInApp: true,
      channelPush: true,
      deepLink: {
        kind: 'gardenToday',
        gardenId: GARDEN_ID,
        recommendationCandidateId: candidateId,
      },
      dedupKey: `care_recommendation:candidate:${candidateId}`,
      earliestDeliveryAt: new Date('2026-07-20T11:00:00Z'),
      expiresAt: new Date('2026-07-27T12:00:00Z'),
      ...options.intent,
    },
    new Date('2026-07-20T11:00:00Z'),
  );

  return intentId;
}

function intentState(harness: Harness, id: Uuid): { state: string; closeReason: string | null } {
  const row = harness.fakes.intents.rows.get(id);
  if (row === undefined) {
    throw new Error('intent row missing');
  }
  return { state: row.state, closeReason: row.closeReason };
}

describe('RunNotificationDeliverySweep', () => {
  it('claims a due intent, sends the identifier-only payload to every active device, and marks it sent', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, {
      deviceTokens: ['token-a', 'token-b'],
    });

    const result = await harness.sweep.execute();

    expect(result).toMatchObject({
      intentsClaimed: 1,
      intentsSent: 1,
      attemptOutcomes: { accepted: 2 },
      devicesDisabled: 0,
      lostRaces: 0,
    });
    expect(harness.sender.sent.map((message) => message.token).sort()).toEqual([
      'token-a',
      'token-b',
    ]);
    const [message] = harness.sender.sent;
    expect(message?.priority).toBe('high');
    expect(message?.data['deepLinkKind']).toBe('gardenToday');
    expect(message?.data['gardenId']).toBe(GARDEN_ID);
    // Nothing rendered, nothing private: identifiers and the template key only.
    expect(Object.keys(message?.data ?? {}).sort()).toEqual([
      'deepLinkKind',
      'gardenId',
      'notificationId',
      'notificationType',
      'recommendationCandidateId',
      'templateKey',
    ]);
    expect(intentState(harness, intentId)).toEqual({ state: 'sent', closeReason: null });
    expect(harness.fakes.delivery.attempts).toHaveLength(2);
    expect(harness.fakes.intents.rows.get(intentId)?.deliveryAttemptCount).toBe(1);
  });

  it('claims only what is due: future earliest-delivery, in-app-only, leased, and expired intents stay untouched', async () => {
    const harness = createHarness();
    const future = await seedDeliverableIntent(harness, {
      intent: { earliestDeliveryAt: new Date('2026-07-20T13:00:00Z') },
    });
    const inAppOnly = await seedDeliverableIntent(harness, { intent: { channelPush: false } });
    const leased = await seedDeliverableIntent(harness);
    const leasedRow = harness.fakes.intents.rows.get(leased);
    if (leasedRow !== undefined) {
      harness.fakes.intents.rows.set(leased, {
        ...leasedRow,
        nextDeliveryAttemptAt: new Date('2026-07-20T12:04:00Z'),
      });
    }

    const result = await harness.sweep.execute();

    expect(result.intentsClaimed).toBe(0);
    expect(result.intentsSent).toBe(0);
    expect(harness.sender.sent).toHaveLength(0);
    expect(intentState(harness, future).state).toBe('pending');
    expect(intentState(harness, inAppOnly).state).toBe('pending');
    expect(intentState(harness, leased).state).toBe('pending');
  });

  it('closes past-expiry pending intents at scale — in-app-only ones included, the P7-NOTIF-01 deferred close', async () => {
    const harness = createHarness();
    const lapsedPush = await seedDeliverableIntent(harness, {
      intent: { expiresAt: new Date('2026-07-20T11:59:00Z') },
    });
    const lapsedInApp = await seedDeliverableIntent(harness, {
      intent: { channelPush: false, expiresAt: new Date('2026-07-20T10:00:00Z') },
    });
    const live = await seedDeliverableIntent(harness);

    const result = await harness.sweep.execute();

    expect(result.intentsExpired).toBe(2);
    expect(intentState(harness, lapsedPush).state).toBe('expired');
    expect(intentState(harness, lapsedInApp).state).toBe('expired');
    expect(intentState(harness, live).state).toBe('sent');
  });

  it('INVALID TOKEN: disables the dead device idempotently, records the attempt, and still sends through the surviving device', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, {
      deviceTokens: ['dead-token', 'live-token'],
    });
    harness.sender.scriptOutcome('dead-token', {
      kind: 'token_invalid',
      errorCode: 'messaging/registration-token-not-registered',
    });

    const result = await harness.sweep.execute();

    expect(result).toMatchObject({
      intentsSent: 1,
      attemptOutcomes: { accepted: 1, token_invalid: 1 },
      devicesDisabled: 1,
    });
    expect(intentState(harness, intentId).state).toBe('sent');

    const devices = [...harness.fakes.devices.rows.values()];
    const dead = devices.find((device) => device.fcmToken === 'dead-token');
    expect(dead?.status).toBe('disabled');
    expect(dead?.disabledReason).toBe('token_invalid');
    expect(devices.find((device) => device.fcmToken === 'live-token')?.status).toBe('active');

    const attempts = harness.fakes.delivery.attempts;
    expect(attempts.map((attempt) => attempt.outcome).sort()).toEqual([
      'accepted',
      'token_invalid',
    ]);
    expect(attempts.find((attempt) => attempt.outcome === 'token_invalid')?.errorCode).toBe(
      'messaging/registration-token-not-registered',
    );
  });

  it('INVALID TOKEN, every device: the intent fails as all_tokens_invalid and the disable is not repeated on a later verdict', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, { deviceTokens: ['dead-token'] });
    harness.sender.scriptOutcome('dead-token', {
      kind: 'token_invalid',
      errorCode: 'messaging/registration-token-not-registered',
    });

    const result = await harness.sweep.execute();

    expect(result.intentsFailed).toEqual({ all_tokens_invalid: 1 });
    expect(result.devicesDisabled).toBe(1);
    expect(intentState(harness, intentId)).toEqual({
      state: 'failed',
      closeReason: 'all_tokens_invalid',
    });

    // The disable is idempotent: a direct repeat verdict is a counted no-op.
    const dead = [...harness.fakes.devices.rows.values()][0];
    expect(dead).toBeDefined();
    if (dead !== undefined) {
      await expect(harness.fakes.devices.disable(dead.id, 'token_invalid', NOW)).resolves.toBe(
        false,
      );
    }
  });

  it('STALE INTENT: a candidate superseded after intent creation skips with its typed reason and no push', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, { candidateState: 'superseded' });

    const result = await harness.sweep.execute();

    expect(result.intentsSkipped).toEqual({ candidate_not_live: 1 });
    expect(harness.sender.sent).toHaveLength(0);
    expect(intentState(harness, intentId)).toEqual({
      state: 'skipped',
      closeReason: 'candidate_not_live',
    });
    // No FCM attempt happened, so no attempt record exists — skips are
    // intent-level outcomes.
    expect(harness.fakes.delivery.attempts).toHaveLength(0);
  });

  it('ACCESS RECHECK: membership removed before delivery skips without a push', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, { memberOfGarden: false });

    const result = await harness.sweep.execute();

    expect(result.intentsSkipped).toEqual({ recipient_access_revoked: 1 });
    expect(harness.sender.sent).toHaveLength(0);
    expect(intentState(harness, intentId).state).toBe('skipped');
  });

  it('PREFERENCE RECHECK: quiet hours written after intent creation defer the still-pending intent to the window end', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness);
    harness.fakes.preferences.settingsByProfile.set(PROFILE_ID, {
      // 12:00Z sits inside a 11:00-14:00 UTC window written AFTER the
      // intent (its earliestDeliveryAt already passed).
      quietHours: { startMinute: 11 * 60, endMinute: 14 * 60 },
      quietHoursTimeZone: 'UTC',
      revision: 1,
    });

    const result = await harness.sweep.execute();

    expect(result.intentsDeferred).toBe(1);
    expect(harness.sender.sent).toHaveLength(0);
    const row = harness.fakes.intents.rows.get(intentId);
    expect(row?.state).toBe('pending');
    expect(row?.nextDeliveryAttemptAt).toEqual(new Date('2026-07-20T14:00:00Z'));
    // A deferral consumes no attempt round.
    expect(row?.deliveryAttemptCount).toBe(0);
  });

  it('TRANSIENT FAILURE: schedules a bounded backoff retry and leaves the intent pending', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, { deviceTokens: ['flaky-token'] });
    harness.sender.scriptOutcome('flaky-token', {
      kind: 'transient_failure',
      errorCode: 'messaging/server-unavailable',
    });

    const result = await harness.sweep.execute();

    expect(result.retriesScheduled).toBe(1);
    const row = harness.fakes.intents.rows.get(intentId);
    expect(row?.state).toBe('pending');
    expect(row?.deliveryAttemptCount).toBe(1);
    // First retry: five minutes out.
    expect(row?.nextDeliveryAttemptAt).toEqual(new Date('2026-07-20T12:05:00Z'));
  });

  it('TRANSIENT FAILURE at the budget ceiling: closes failed as retry_budget_exhausted', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness, { deviceTokens: ['flaky-token'] });
    const row = harness.fakes.intents.rows.get(intentId);
    if (row !== undefined) {
      // Four rounds already consumed; this run's send is the fifth and last.
      harness.fakes.intents.rows.set(intentId, {
        ...row,
        deliveryAttemptCount: MAX_DELIVERY_ATTEMPTS - 1,
      });
    }
    harness.sender.scriptOutcome('flaky-token', {
      kind: 'transient_failure',
      errorCode: 'messaging/internal-error',
    });

    const result = await harness.sweep.execute();

    expect(result.intentsFailed).toEqual({ retry_budget_exhausted: 1 });
    expect(intentState(harness, intentId)).toEqual({
      state: 'failed',
      closeReason: 'retry_budget_exhausted',
    });
  });

  it('PERMANENT FAILURE: records the failed intent without poisoning the rest of the batch', async () => {
    const harness = createHarness();
    // Two recipients so each intent has exactly its own device set.
    const broken = await seedDeliverableIntent(harness, { deviceTokens: ['broken-token'] });
    const healthy = await seedDeliverableIntent(harness, {
      deviceTokens: ['healthy-token'],
      profileId: '01890000-0000-7000-8000-00000000cccc',
    });
    harness.sender.scriptOutcome('broken-token', {
      kind: 'permanent_failure',
      errorCode: 'messaging/payload-size-limit-exceeded',
    });

    const result = await harness.sweep.execute();

    expect(result.intentsFailed).toEqual({ provider_permanent_failure: 1 });
    expect(result.intentsSent).toBe(1);
    expect(intentState(harness, broken)).toEqual({
      state: 'failed',
      closeReason: 'provider_permanent_failure',
    });
    expect(intentState(harness, healthy).state).toBe('sent');
    // The permanent failure never disables the device: the token may be
    // fine, the payload or credential was not.
    const brokenDevice = [...harness.fakes.devices.rows.values()].find(
      (device) => device.fcmToken === 'broken-token',
    );
    expect(brokenDevice?.status).toBe('active');
  });

  it('advances the claim lease so an immediate second run cannot double-send the same intent', async () => {
    const harness = createHarness();
    const intentId = await seedDeliverableIntent(harness);
    const leaseUntil = new Date(NOW.getTime() + DELIVERY_CLAIM_LEASE_MS);

    const claimed = await harness.fakes.delivery.claimDueForDelivery(NOW, leaseUntil, 25);
    expect(claimed.map((intent) => intent.id)).toEqual([intentId]);
    expect(claimed[0]?.nextDeliveryAttemptAt).toEqual(leaseUntil);

    // The same due predicate immediately after: the lease excludes the row.
    const second = await harness.fakes.delivery.claimDueForDelivery(NOW, leaseUntil, 25);
    expect(second).toHaveLength(0);
  });
});
