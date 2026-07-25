import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { NewNotificationIntent } from './notification-intent-repository.js';
import { ListNotifications } from './list-notifications.js';
import {
  createNotificationsFakes,
  FakeNotificationsUnitOfWork,
  fixedClock,
} from './notification-test-doubles.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const ME = '01890000-0000-7000-8000-0000000000f1';
const SOMEONE_ELSE = '01890000-0000-7000-8000-0000000000f2';
const GARDEN = '01890000-0000-7000-8000-0000000000a1';

function newIntent(
  id: string,
  overrides: Partial<NewNotificationIntent> = {},
): NewNotificationIntent {
  return {
    id,
    intentType: 'care_recommendation',
    intentVersion: 1,
    recipientProfileId: ME,
    gardenId: GARDEN,
    recommendationCandidateId: id,
    sourceEventId: id,
    traceId: null,
    templateKey: 'care_recommendation.created.v1',
    templateParameters: { ruleKey: 'observation_reminder' },
    priority: 'normal',
    channelInApp: true,
    channelPush: true,
    deepLink: { kind: 'gardenToday', gardenId: GARDEN, recommendationCandidateId: id },
    dedupKey: `care_recommendation:candidate:${id}`,
    earliestDeliveryAt: NOW,
    expiresAt: new Date('2026-07-27T12:00:00Z'),
    ...overrides,
  };
}

// UUIDv7-shaped ids whose lexicographic order IS their creation order.
const OLDEST = '01890000-0000-7000-8000-000000000001';
const MIDDLE = '01890000-0000-7000-8000-000000000002';
const NEWEST = '01890000-0000-7000-8000-000000000003';

function setUp(): {
  fakes: ReturnType<typeof createNotificationsFakes>;
  useCase: ListNotifications;
} {
  const fakes = createNotificationsFakes();
  const useCase = new ListNotifications(new FakeNotificationsUnitOfWork(fakes), fixedClock(NOW));
  return { fakes, useCase };
}

describe('ListNotifications', () => {
  it("lists only the caller's live in-app entries, newest first, mapped to the contract shape", async () => {
    const { fakes, useCase } = setUp();
    await fakes.intents.insertIfAbsent(newIntent(OLDEST), NOW);
    await fakes.intents.insertIfAbsent(newIntent(NEWEST), NOW);
    await fakes.intents.insertIfAbsent(
      newIntent(MIDDLE, { recipientProfileId: SOMEONE_ELSE }),
      NOW,
    );

    const { result } = await useCase.execute(ME, null, 50);

    expect(result.items.map((item) => item.id)).toEqual([NEWEST, OLDEST]);
    expect(result.items[0]).toEqual({
      id: NEWEST,
      notificationType: 'care_recommendation',
      priority: 'normal',
      gardenId: GARDEN,
      recommendationCandidateId: NEWEST,
      templateKey: 'care_recommendation.created.v1',
      parameters: { ruleKey: 'observation_reminder' },
      deepLink: { kind: 'gardenToday', gardenId: GARDEN, recommendationCandidateId: NEWEST },
      readAt: null,
      dismissedAt: null,
      expiresAt: '2026-07-27T12:00:00.000Z',
      createdAt: NOW.toISOString(),
    });
    expect(result.nextCursor).toBeUndefined();
  });

  it('excludes dismissed and push-only entries but keeps read ones listed', async () => {
    const { fakes, useCase } = setUp();
    await fakes.intents.insertIfAbsent(newIntent(OLDEST), NOW);
    await fakes.intents.insertIfAbsent(newIntent(MIDDLE, { channelInApp: false }), NOW);
    await fakes.intents.insertIfAbsent(newIntent(NEWEST), NOW);
    await fakes.intents.markDismissed(OLDEST, ME, NOW);
    await fakes.intents.markRead(NEWEST, ME, NOW);

    const { result } = await useCase.execute(ME, null, 50);

    expect(result.items.map((item) => item.id)).toEqual([NEWEST]);
    expect(result.items[0]?.readAt).toBe(NOW.toISOString());
  });

  it("durably expires the caller's own past-expiry pending intents in the same read", async () => {
    const { fakes, useCase } = setUp();
    await fakes.intents.insertIfAbsent(
      newIntent(OLDEST, { expiresAt: new Date('2026-07-20T11:00:00Z') }),
      NOW,
    );
    await fakes.intents.insertIfAbsent(newIntent(NEWEST), NOW);

    const outcome = await useCase.execute(ME, null, 50);

    expect(outcome.intentsExpired).toBe(1);
    expect(outcome.result.items.map((item) => item.id)).toEqual([NEWEST]);
    // The close is durable state, not a filtered view.
    expect(fakes.intents.rows.get(OLDEST)?.state).toBe('expired');
    expect(fakes.intents.rows.get(OLDEST)?.revision).toBe(2);
    // A repeat read finds nothing left to expire — idempotent.
    const repeat = await useCase.execute(ME, null, 50);
    expect(repeat.intentsExpired).toBe(0);
  });

  it('paginates with an opaque keyset cursor', async () => {
    const { fakes, useCase } = setUp();
    await fakes.intents.insertIfAbsent(newIntent(OLDEST), NOW);
    await fakes.intents.insertIfAbsent(newIntent(MIDDLE), NOW);
    await fakes.intents.insertIfAbsent(newIntent(NEWEST), NOW);

    const first = await useCase.execute(ME, null, 2);
    expect(first.result.items.map((item) => item.id)).toEqual([NEWEST, MIDDLE]);
    expect(first.result.nextCursor).toBeDefined();

    const second = await useCase.execute(ME, first.result.nextCursor ?? null, 2);
    expect(second.result.items.map((item) => item.id)).toEqual([OLDEST]);
    expect(second.result.nextCursor).toBeUndefined();
  });

  it('rejects an unparseable cursor', async () => {
    const { useCase } = setUp();
    await expect(useCase.execute(ME, 'not-base64-json', 50)).rejects.toThrow(ValidationError);
  });
});
