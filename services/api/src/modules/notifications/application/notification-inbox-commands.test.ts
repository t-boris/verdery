import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { NewNotificationIntent } from './notification-intent-repository.js';
import { DismissNotification, MarkNotificationRead } from './notification-inbox-commands.js';
import { createNotificationsFakes, fixedClock } from './notification-test-doubles.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const LATER = new Date('2026-07-20T13:00:00Z');
const ME = '01890000-0000-7000-8000-0000000000f1';
const SOMEONE_ELSE = '01890000-0000-7000-8000-0000000000f2';
const GARDEN = '01890000-0000-7000-8000-0000000000a1';
const INTENT = '01890000-0000-7000-8000-000000000001';

function newIntent(overrides: Partial<NewNotificationIntent> = {}): NewNotificationIntent {
  return {
    id: INTENT,
    intentType: 'care_recommendation',
    intentVersion: 1,
    recipientProfileId: ME,
    gardenId: GARDEN,
    recommendationCandidateId: INTENT,
    sourceEventId: INTENT,
    traceId: null,
    templateKey: 'care_recommendation.created.v1',
    templateParameters: {},
    priority: 'normal',
    channelInApp: true,
    channelPush: true,
    deepLink: { kind: 'gardenToday', gardenId: GARDEN, recommendationCandidateId: INTENT },
    dedupKey: `care_recommendation:candidate:${INTENT}`,
    earliestDeliveryAt: NOW,
    expiresAt: new Date('2026-07-27T12:00:00Z'),
    ...overrides,
  };
}

describe('MarkNotificationRead', () => {
  it('stamps the first read time and keeps it on every later call — naturally idempotent', async () => {
    const fakes = createNotificationsFakes();
    await fakes.intents.insertIfAbsent(newIntent(), NOW);

    const first = await new MarkNotificationRead(fakes.intents, fixedClock(NOW)).execute(
      INTENT,
      ME,
    );
    expect(first.readAt).toBe(NOW.toISOString());

    const second = await new MarkNotificationRead(fakes.intents, fixedClock(LATER)).execute(
      INTENT,
      ME,
    );
    expect(second.readAt).toBe(NOW.toISOString());
    // Exactly one revision bump — the second call wrote nothing.
    expect(fakes.intents.rows.get(INTENT)?.revision).toBe(2);
  });

  it("conceals another recipient's notification as not-found", async () => {
    const fakes = createNotificationsFakes();
    await fakes.intents.insertIfAbsent(newIntent({ recipientProfileId: SOMEONE_ELSE }), NOW);

    await expect(
      new MarkNotificationRead(fakes.intents, fixedClock(NOW)).execute(INTENT, ME),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('DismissNotification', () => {
  it('stamps dismissal without touching the delivery state', async () => {
    const fakes = createNotificationsFakes();
    await fakes.intents.insertIfAbsent(newIntent(), NOW);

    const dismissed = await new DismissNotification(fakes.intents, fixedClock(NOW)).execute(
      INTENT,
      ME,
    );

    expect(dismissed.dismissedAt).toBe(NOW.toISOString());
    expect(fakes.intents.rows.get(INTENT)?.state).toBe('pending');
  });

  it('converges on repeat, keeping the first dismissal time', async () => {
    const fakes = createNotificationsFakes();
    await fakes.intents.insertIfAbsent(newIntent(), NOW);

    await new DismissNotification(fakes.intents, fixedClock(NOW)).execute(INTENT, ME);
    const repeat = await new DismissNotification(fakes.intents, fixedClock(LATER)).execute(
      INTENT,
      ME,
    );

    expect(repeat.dismissedAt).toBe(NOW.toISOString());
  });

  it('reports an unknown id as not-found', async () => {
    const fakes = createNotificationsFakes();
    await expect(
      new DismissNotification(fakes.intents, fixedClock(NOW)).execute(INTENT, ME),
    ).rejects.toThrow(NotFoundError);
  });
});
