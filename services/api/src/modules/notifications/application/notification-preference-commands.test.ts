import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  StaleRevisionError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import { CARE_RECOMMENDATION_INTENT_TYPE } from '../domain/notification-preference.js';
import {
  GetNotificationPreferences,
  UpdateNotificationPreferences,
} from './notification-preference-commands.js';
import type { UpdateNotificationPreferencesInput } from './notification-preference-commands.js';
import {
  createNotificationsFakes,
  FakeNotificationsUnitOfWork,
  fixedClock,
} from './notification-test-doubles.js';
import {
  authorizationDenying,
  authorizationGranting,
} from './notification-authorization-test-doubles.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const ME = '01890000-0000-7000-8000-0000000000f1';
const GARDEN = '01890000-0000-7000-8000-0000000000a1';
const KEY = '01890000-0000-7000-8000-00000000cafe';
const KEY_2 = '01890000-0000-7000-8000-00000000cafd';

function input(
  overrides: Partial<UpdateNotificationPreferencesInput> = {},
): UpdateNotificationPreferencesInput {
  return {
    quietHours: { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: 'Europe/Berlin' },
    entries: [
      {
        notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
        gardenId: null,
        inAppEnabled: true,
        pushEnabled: false,
      },
    ],
    ...overrides,
  };
}

function setUp(granted = true): {
  fakes: ReturnType<typeof createNotificationsFakes>;
  update: UpdateNotificationPreferences;
  get: GetNotificationPreferences;
} {
  const fakes = createNotificationsFakes();
  const update = new UpdateNotificationPreferences(
    fakes.idempotency,
    new FakeNotificationsUnitOfWork(fakes),
    granted
      ? authorizationGranting({ id: 'm1', gardenId: GARDEN, profileId: ME, role: 'viewer' })
      : authorizationDenying(),
    fixedClock(NOW),
  );
  return { fakes, update, get: new GetNotificationPreferences(fakes.preferences) };
}

describe('GetNotificationPreferences', () => {
  it('returns the revision-0 default document for a profile that never wrote preferences', async () => {
    const { get } = setUp();
    expect(await get.execute(ME)).toEqual({ revision: 0, quietHours: null, entries: [] });
  });
});

describe('UpdateNotificationPreferences', () => {
  it('creates the document on a first write with expected revision 0 and reads it back', async () => {
    const { get, update } = setUp();

    const result = await update.execute(ME, 0, input(), KEY);

    expect(result).toEqual({
      revision: 1,
      quietHours: { startMinute: 1320, endMinute: 420, timeZone: 'Europe/Berlin' },
      entries: [
        {
          notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
          gardenId: null,
          inAppEnabled: true,
          pushEnabled: false,
        },
      ],
    });
    expect(await get.execute(ME)).toEqual(result);
  });

  it('replaces the whole document on a later write — absent entries revert to the default', async () => {
    const { get, update } = setUp();
    await update.execute(ME, 0, input(), KEY);

    const replaced = await update.execute(ME, 1, { quietHours: null, entries: [] }, KEY_2);

    expect(replaced).toEqual({ revision: 2, quietHours: null, entries: [] });
    expect(await get.execute(ME)).toEqual(replaced);
  });

  it('rejects a stale expected revision — including a lost concurrent first write', async () => {
    const { update } = setUp();
    await update.execute(ME, 0, input(), KEY);

    await expect(update.execute(ME, 0, input({ quietHours: null }), KEY_2)).rejects.toThrow(
      StaleRevisionError,
    );
  });

  it('replays the stored result for the same idempotency key without writing twice', async () => {
    const { fakes, update } = setUp();
    const first = await update.execute(ME, 0, input(), KEY);
    const replay = await update.execute(ME, 0, input(), KEY);

    expect(replay).toEqual(first);
    expect(fakes.preferences.settingsByProfile.get(ME)?.revision).toBe(1);
  });

  it('requires active membership on every garden a scoped entry names, concealing absence', async () => {
    const { update } = setUp(false);

    await expect(
      update.execute(
        ME,
        0,
        input({
          entries: [
            {
              notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
              gardenId: GARDEN,
              inAppEnabled: false,
              pushEnabled: false,
            },
          ],
        }),
        KEY,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('accepts a garden-scoped entry from a member', async () => {
    const { update } = setUp();

    const result = await update.execute(
      ME,
      0,
      input({
        entries: [
          {
            notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
            gardenId: GARDEN,
            inAppEnabled: false,
            pushEnabled: false,
          },
        ],
      }),
      KEY,
    );

    expect(result.entries[0]?.gardenId).toBe(GARDEN);
  });

  it('rejects unknown notification types — the vocabulary is server-owned', async () => {
    const { update } = setUp();

    await expect(
      update.execute(
        ME,
        0,
        input({
          entries: [
            { notificationType: 'surprise', gardenId: null, inAppEnabled: true, pushEnabled: true },
          ],
        }),
        KEY,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects duplicated type/garden combinations and invalid zone overrides', async () => {
    const { update } = setUp();

    await expect(
      update.execute(
        ME,
        0,
        input({
          entries: [
            {
              notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
              gardenId: null,
              inAppEnabled: true,
              pushEnabled: true,
            },
            {
              notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
              gardenId: null,
              inAppEnabled: false,
              pushEnabled: false,
            },
          ],
        }),
        KEY,
      ),
    ).rejects.toThrow(ValidationError);

    await expect(
      update.execute(
        ME,
        0,
        input({
          quietHours: { startMinute: 0, endMinute: 60, timeZone: 'Mars/Olympus_Mons' },
        }),
        KEY_2,
      ),
    ).rejects.toThrow(ValidationError);
  });
});
