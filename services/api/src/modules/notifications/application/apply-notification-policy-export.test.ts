/**
 * `ApplyNotificationPolicy`'s `export.completed` branch (P8-EXPORT-01):
 * exactly one recipient (the requester), in-app only, deduplicated on the
 * export request id, expiring with the package it announces, honest about
 * a null garden for account-wide exports — split from the
 * candidate-created suite for the 600-line file rule.
 */

import { describe, expect, it } from 'vitest';
import type { NotificationDomainEventEnvelope } from '@verdery/api-contracts';
import { EXPORT_COMPLETED_EVENT_TYPE } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { EXPORT_READY_INTENT_TYPE } from '../domain/notification-preference.js';
import { ApplyNotificationPolicy } from './apply-notification-policy.js';
import {
  createNotificationsFakes,
  FakeNotificationsUnitOfWork,
  fixedClock,
} from './notification-test-doubles.js';

const NOW = new Date('2026-07-25T12:00:00Z');
const EVENT_ID = '01890000-0000-7000-8000-0000000000e2';
const EXPORT_REQUEST = '01890000-0000-7000-8000-0000000000d1';
const REQUESTER = '01890000-0000-7000-8000-0000000000f1';
const EXPIRES_AT = '2026-08-01T12:00:00.000Z';

function exportEnvelope(
  payloadOverrides: Record<string, unknown> = {},
): NotificationDomainEventEnvelope {
  return {
    id: EVENT_ID,
    eventType: EXPORT_COMPLETED_EVENT_TYPE,
    payload: {
      exportRequestId: EXPORT_REQUEST,
      requesterProfileId: REQUESTER,
      scope: 'account',
      gardenId: null,
      outputMediaId: '01890000-0000-7000-8000-0000000000d2',
      expiresAt: EXPIRES_AT,
      ...payloadOverrides,
    },
    traceId: 'trace-e1',
    occurredAt: NOW.toISOString(),
  };
}

function setUp() {
  const fakes = createNotificationsFakes();
  fakes.recipients.profiles.set(REQUESTER, {
    profileId: REQUESTER,
    accountState: 'active',
    timeZone: 'UTC',
  });
  const useCase = new ApplyNotificationPolicy(
    new FakeNotificationsUnitOfWork(fakes),
    fixedClock(NOW),
  );
  return { fakes, useCase };
}

describe('ApplyNotificationPolicy — export.completed', () => {
  it('creates exactly one in-app-only intent for the requester, with a null garden and the package expiry', async () => {
    const { fakes, useCase } = setUp();

    const summary = await useCase.execute(exportEnvelope());

    expect(summary).toEqual({
      eventType: EXPORT_COMPLETED_EVENT_TYPE,
      recipientsConsidered: 1,
      intentsCreated: 1,
      intentsDeduplicated: 0,
      suppressed: {},
      priorIntentsSuperseded: 0,
    });

    const intents = [...fakes.intents.rows.values()];
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      intentType: EXPORT_READY_INTENT_TYPE,
      recipientProfileId: REQUESTER,
      gardenId: null,
      recommendationCandidateId: null,
      sourceEventId: EVENT_ID,
      templateKey: 'export_ready.completed.v1',
      priority: 'normal',
      channelInApp: true,
      channelPush: false,
      deepLink: { kind: 'exportReady', exportRequestId: EXPORT_REQUEST },
      dedupKey: `export_ready:request:${EXPORT_REQUEST}`,
    });
    expect(intents[0]?.expiresAt.toISOString()).toBe(EXPIRES_AT);
    expect(intents[0]?.templateParameters).toMatchObject({
      exportRequestId: EXPORT_REQUEST,
      scope: 'account',
      expiresAt: EXPIRES_AT,
    });
  });

  it('a redelivered event deduplicates instead of creating a second inbox entry', async () => {
    const { fakes, useCase } = setUp();

    await useCase.execute(exportEnvelope());
    const replay = await useCase.execute(exportEnvelope());

    expect(replay.intentsCreated).toBe(0);
    expect(replay.intentsDeduplicated).toBe(1);
    expect(fakes.intents.rows.size).toBe(1);
  });

  it('a garden-scoped export carries its garden id on the intent', async () => {
    const gardenId = '01890000-0000-7000-8000-0000000000a1';
    const { fakes, useCase } = setUp();

    await useCase.execute(exportEnvelope({ scope: 'garden', gardenId }));

    expect([...fakes.intents.rows.values()][0]?.gardenId).toBe(gardenId);
  });

  it('suppresses when the requester profile is missing or not usable', async () => {
    const { fakes, useCase } = setUp();
    fakes.recipients.profiles.set(REQUESTER, {
      profileId: REQUESTER,
      accountState: 'deletion_requested',
      timeZone: 'UTC',
    });

    const summary = await useCase.execute(exportEnvelope());

    expect(summary.intentsCreated).toBe(0);
    expect(summary.suppressed).toEqual({ account_not_usable: 1 });
    expect(fakes.intents.rows.size).toBe(0);
  });

  it('honors an explicit in-app opt-out for the export_ready type', async () => {
    const { fakes, useCase } = setUp();
    fakes.preferences.entriesByProfile.set(REQUESTER, [
      {
        notificationType: EXPORT_READY_INTENT_TYPE,
        gardenId: null,
        inAppEnabled: false,
        pushEnabled: false,
      },
    ]);

    const summary = await useCase.execute(exportEnvelope());

    expect(summary.suppressed).toEqual({ channels_disabled: 1 });
    expect(fakes.intents.rows.size).toBe(0);
  });

  it('rejects a malformed payload loudly — a defect between trusted components', async () => {
    const { useCase } = setUp();

    await expect(useCase.execute(exportEnvelope({ expiresAt: 'not-a-date' }))).rejects.toThrow(
      ValidationError,
    );
  });
});
