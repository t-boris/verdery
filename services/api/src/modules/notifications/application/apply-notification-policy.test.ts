/**
 * Notification policy tests at the use-case layer (P7-NOTIF-01) — the
 * acceptance evidence over the whole event flow: recipient fan-out,
 * preference and garden-override resolution, quiet-hours deferral in the
 * recipient's own zone, durable dedup on redelivery, freshness
 * suppression of a stale backlog, and supersession closing prior intents.
 */

import { describe, expect, it } from 'vitest';
import type { NotificationDomainEventEnvelope } from '@verdery/api-contracts';
import { RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE } from '@verdery/api-contracts';
import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import { CARE_RECOMMENDATION_INTENT_TYPE } from '../domain/notification-preference.js';
import { ApplyNotificationPolicy } from './apply-notification-policy.js';
import {
  createNotificationsFakes,
  FakeNotificationsUnitOfWork,
  fixedClock,
} from './notification-test-doubles.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const EVENT_ID = '01890000-0000-7000-8000-0000000000e1';
const CANDIDATE = '01890000-0000-7000-8000-0000000000c1';
const PRIOR_CANDIDATE = '01890000-0000-7000-8000-0000000000c0';
const GARDEN = '01890000-0000-7000-8000-0000000000a1';
const OWNER = '01890000-0000-7000-8000-0000000000f1';
const VIEWER = '01890000-0000-7000-8000-0000000000f2';

function envelope(
  overrides: Partial<NotificationDomainEventEnvelope> = {},
  payloadOverrides: Record<string, unknown> = {},
): NotificationDomainEventEnvelope {
  return {
    id: EVENT_ID,
    eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
    payload: {
      candidateId: CANDIDATE,
      gardenId: GARDEN,
      ruleKey: 'observation_reminder',
      ruleVersion: 1,
      targetKind: 'plant',
      targetPlantId: '01890000-0000-7000-8000-0000000000b1',
      targetGardenAreaMapObjectId: null,
      urgency: 'normal',
      priorityScore: 40,
      windowStart: '2026-07-18T00:00:00Z',
      windowEnd: '2026-07-25T12:00:00Z',
      supersedesCandidateId: null,
      ...payloadOverrides,
    },
    traceId: 'trace-1',
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

function setUp(): {
  fakes: ReturnType<typeof createNotificationsFakes>;
  useCase: ApplyNotificationPolicy;
} {
  const fakes = createNotificationsFakes();
  fakes.recommendationFreshness.candidates.set(CANDIDATE, {
    id: CANDIDATE,
    gardenId: GARDEN,
    state: 'eligible',
    windowEnd: new Date('2026-07-25T12:00:00Z'),
  });
  fakes.recipients.recipientsByGarden.set(GARDEN, [
    { profileId: OWNER, accountState: 'active', timeZone: 'UTC' },
    { profileId: VIEWER, accountState: 'active', timeZone: 'UTC' },
  ]);
  const useCase = new ApplyNotificationPolicy(
    new FakeNotificationsUnitOfWork(fakes),
    fixedClock(NOW),
  );
  return { fakes, useCase };
}

describe('ApplyNotificationPolicy', () => {
  it('creates one durable pending intent per active member, carrying every section-4 field', async () => {
    const { fakes, useCase } = setUp();

    const summary = await useCase.execute(envelope());

    expect(summary).toEqual({
      eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
      recipientsConsidered: 2,
      intentsCreated: 2,
      intentsDeduplicated: 0,
      suppressed: {},
      priorIntentsSuperseded: 0,
    });

    const intents = [...fakes.intents.rows.values()];
    expect(intents).toHaveLength(2);
    expect(new Set(intents.map((intent) => intent.recipientProfileId))).toEqual(
      new Set([OWNER, VIEWER]),
    );

    const intent = intents.find((row) => row.recipientProfileId === OWNER);
    expect(intent).toMatchObject({
      intentType: CARE_RECOMMENDATION_INTENT_TYPE,
      intentVersion: 1,
      gardenId: GARDEN,
      recommendationCandidateId: CANDIDATE,
      sourceEventId: EVENT_ID,
      traceId: 'trace-1',
      templateKey: 'care_recommendation.created.v1',
      priority: 'normal',
      channelInApp: true,
      channelPush: true,
      deepLink: { kind: 'gardenToday', gardenId: GARDEN, recommendationCandidateId: CANDIDATE },
      state: 'pending',
      // Immediate delivery (no quiet hours), expiry = the candidate's own
      // validity-window end.
      earliestDeliveryAt: NOW,
      expiresAt: new Date('2026-07-25T12:00:00Z'),
    });
    // Structured parameters, never rendered text.
    expect(intent?.templateParameters).toMatchObject({
      ruleKey: 'observation_reminder',
      urgency: 'normal',
      targetKind: 'plant',
    });
  });

  it('collapses a redelivered event to zero new intents — the relay crash window', async () => {
    const { fakes, useCase } = setUp();

    await useCase.execute(envelope());
    const summary = await useCase.execute(envelope());

    expect(summary.intentsCreated).toBe(0);
    expect(summary.intentsDeduplicated).toBe(2);
    expect(fakes.intents.rows.size).toBe(2);
  });

  it('respects a global preference disabling every channel, per recipient', async () => {
    const { fakes, useCase } = setUp();
    fakes.preferences.entriesByProfile.set(VIEWER, [
      {
        notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
        gardenId: null,
        inAppEnabled: false,
        pushEnabled: false,
      },
    ]);

    const summary = await useCase.execute(envelope());

    expect(summary.intentsCreated).toBe(1);
    expect(summary.suppressed).toEqual({ channels_disabled: 1 });
    expect(
      [...fakes.intents.rows.values()].every((intent) => intent.recipientProfileId === OWNER),
    ).toBe(true);
  });

  it('lets a garden-scoped override re-enable what the global entry disabled', async () => {
    const { fakes, useCase } = setUp();
    fakes.preferences.entriesByProfile.set(VIEWER, [
      {
        notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
        gardenId: null,
        inAppEnabled: false,
        pushEnabled: false,
      },
      {
        notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
        gardenId: GARDEN,
        inAppEnabled: true,
        pushEnabled: false,
      },
    ]);

    const summary = await useCase.execute(envelope());

    expect(summary.intentsCreated).toBe(2);
    const viewerIntent = [...fakes.intents.rows.values()].find(
      (intent) => intent.recipientProfileId === VIEWER,
    );
    expect(viewerIntent).toMatchObject({ channelInApp: true, channelPush: false });
  });

  it("defers push past quiet hours in each recipient's own zone without delaying the inbox", async () => {
    const { fakes, useCase } = setUp();
    // 12:00Z is 21:00 in Tokyo — inside 20:00-08:00; next end 08:00 Tokyo = 23:00Z.
    fakes.recipients.recipientsByGarden.set(GARDEN, [
      { profileId: OWNER, accountState: 'active', timeZone: 'Asia/Tokyo' },
    ]);
    fakes.preferences.settingsByProfile.set(OWNER, {
      quietHours: { startMinute: 20 * 60, endMinute: 8 * 60 },
      quietHoursTimeZone: null,
      revision: 1,
    });

    await useCase.execute(envelope());

    const intent = [...fakes.intents.rows.values()][0];
    expect(intent?.earliestDeliveryAt).toEqual(new Date('2026-07-20T23:00:00Z'));
    // The intent itself exists NOW — quiet hours defer push, not the inbox.
    expect(intent?.state).toBe('pending');
    expect(intent?.channelInApp).toBe(true);
  });

  it('suppresses recipients whose account is not usable', async () => {
    const { fakes, useCase } = setUp();
    fakes.recipients.recipientsByGarden.set(GARDEN, [
      { profileId: OWNER, accountState: 'active', timeZone: 'UTC' },
      { profileId: VIEWER, accountState: 'suspended', timeZone: 'UTC' },
    ]);

    const summary = await useCase.execute(envelope());

    expect(summary.intentsCreated).toBe(1);
    expect(summary.suppressed).toEqual({ account_not_usable: 1 });
  });

  it('suppresses a stale backlog event whose candidate is no longer live, creating nothing', async () => {
    const { fakes, useCase } = setUp();
    fakes.recommendationFreshness.candidates.set(CANDIDATE, {
      id: CANDIDATE,
      gardenId: GARDEN,
      state: 'completed',
      windowEnd: new Date('2026-07-25T12:00:00Z'),
    });

    const summary = await useCase.execute(envelope());

    expect(summary).toMatchObject({
      recipientsConsidered: 0,
      intentsCreated: 0,
      suppressed: { candidate_not_live: 1 },
    });
    expect(fakes.intents.rows.size).toBe(0);
  });

  it('suppresses an event whose candidate row no longer exists', async () => {
    const { fakes, useCase } = setUp();
    fakes.recommendationFreshness.candidates.clear();

    const summary = await useCase.execute(envelope());

    expect(summary.suppressed).toEqual({ candidate_missing: 1 });
    expect(fakes.intents.rows.size).toBe(0);
  });

  it('suppresses an event whose validity window already passed', async () => {
    const { fakes, useCase } = setUp();
    fakes.recommendationFreshness.candidates.set(CANDIDATE, {
      id: CANDIDATE,
      gardenId: GARDEN,
      state: 'eligible',
      windowEnd: new Date('2026-07-20T11:00:00Z'),
    });

    const summary = await useCase.execute(envelope());

    expect(summary.suppressed).toEqual({ candidate_window_passed: 1 });
    expect(fakes.intents.rows.size).toBe(0);
  });

  it("closes the superseded candidate's pending intents even when the new event is itself stale", async () => {
    const { fakes, useCase } = setUp();
    // A prior candidate's pending intent for the owner.
    await fakes.intents.insertIfAbsent(
      {
        id: '01890000-0000-7000-8000-0000000000d0',
        intentType: CARE_RECOMMENDATION_INTENT_TYPE,
        intentVersion: 1,
        recipientProfileId: OWNER,
        gardenId: GARDEN,
        recommendationCandidateId: PRIOR_CANDIDATE,
        sourceEventId: '01890000-0000-7000-8000-0000000000e0',
        traceId: null,
        templateKey: 'care_recommendation.created.v1',
        templateParameters: {},
        priority: 'normal',
        channelInApp: true,
        channelPush: true,
        deepLink: {
          kind: 'gardenToday',
          gardenId: GARDEN,
          recommendationCandidateId: PRIOR_CANDIDATE,
        },
        dedupKey: `care_recommendation:candidate:${PRIOR_CANDIDATE}`,
        earliestDeliveryAt: NOW,
        expiresAt: new Date('2026-07-30T00:00:00Z'),
      },
      NOW,
    );
    // The NEW candidate is already resolved — stale event — but it names
    // the prior in supersedesCandidateId.
    fakes.recommendationFreshness.candidates.set(CANDIDATE, {
      id: CANDIDATE,
      gardenId: GARDEN,
      state: 'superseded',
      windowEnd: null,
    });

    const summary = await useCase.execute(envelope({}, { supersedesCandidateId: PRIOR_CANDIDATE }));

    expect(summary.priorIntentsSuperseded).toBe(1);
    expect(summary.suppressed).toEqual({ candidate_not_live: 1 });
    const prior = [...fakes.intents.rows.values()].find(
      (intent) => intent.recommendationCandidateId === PRIOR_CANDIDATE,
    );
    expect(prior?.state).toBe('superseded');
    // Repeat delivery: the close is a counted no-op the second time.
    const replay = await useCase.execute(envelope({}, { supersedesCandidateId: PRIOR_CANDIDATE }));
    expect(replay.priorIntentsSuperseded).toBe(0);
  });

  it('rejects an unrecognized event type loudly instead of dropping it', async () => {
    const { useCase } = setUp();
    await expect(
      useCase.execute(envelope({ eventType: 'media.processing_requested' })),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a malformed payload loudly — a defect between trusted components', async () => {
    const { useCase } = setUp();
    await expect(useCase.execute(envelope({}, { candidateId: 'not-a-uuid' }))).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses a garden mismatch between event and stored candidate as an internal defect', async () => {
    const { fakes, useCase } = setUp();
    fakes.recommendationFreshness.candidates.set(CANDIDATE, {
      id: CANDIDATE,
      gardenId: '01890000-0000-7000-8000-0000000000aa',
      state: 'eligible',
      windowEnd: null,
    });

    await expect(useCase.execute(envelope())).rejects.toThrow(InternalError);
  });
});
