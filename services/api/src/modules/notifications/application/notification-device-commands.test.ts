/**
 * Device registration commands over the module fakes (P7-NOTIF-02):
 * register-or-refresh convergence, reactivation after a disable, token
 * displacement across profiles (account switch on one physical device),
 * the server-stamped environment, and idempotent removal.
 */

import { describe, expect, it } from 'vitest';
import {
  RegisterNotificationDevice,
  RemoveNotificationDevice,
} from './notification-device-commands.js';
import {
  createNotificationsFakes,
  FakeNotificationsUnitOfWork,
  fixedClock,
} from './notification-test-doubles.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const LATER = new Date('2026-07-21T09:00:00Z');
const PROFILE_A = '01890000-0000-7000-8000-000000000001';
const PROFILE_B = '01890000-0000-7000-8000-000000000002';
const INSTALLATION_1 = '01890000-0000-7000-8000-000000000011';
const INSTALLATION_2 = '01890000-0000-7000-8000-000000000012';

function createHarness(at: Date = NOW) {
  const fakes = createNotificationsFakes();
  const register = new RegisterNotificationDevice(
    new FakeNotificationsUnitOfWork(fakes),
    fixedClock(at),
    'development',
  );
  const remove = new RemoveNotificationDevice(fakes.devices);
  return { fakes, register, remove };
}

describe('RegisterNotificationDevice', () => {
  it('registers a new device active, stamped with the server environment, and never echoes the token', async () => {
    const { fakes, register } = createHarness();

    const resource = await register.execute(PROFILE_A, INSTALLATION_1, {
      platform: 'ios',
      fcmToken: 'token-one',
    });

    expect(resource).toEqual({
      installationId: INSTALLATION_1,
      platform: 'ios',
      status: 'active',
      lastSeenAt: NOW.toISOString(),
      registeredAt: NOW.toISOString(),
    });
    // The token stays server-side only.
    expect(Object.values(resource)).not.toContain('token-one');

    const stored = [...fakes.devices.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      profileId: PROFILE_A,
      installationId: INSTALLATION_1,
      provider: 'fcm',
      fcmToken: 'token-one',
      environment: 'development',
      status: 'active',
    });
  });

  it('refreshes convergently: same installation, rotated token, one row, updated last-seen', async () => {
    const first = createHarness();
    await first.register.execute(PROFILE_A, INSTALLATION_1, {
      platform: 'ios',
      fcmToken: 'token-one',
    });

    const later = new RegisterNotificationDevice(
      new FakeNotificationsUnitOfWork(first.fakes),
      fixedClock(LATER),
      'development',
    );
    const refreshed = await later.execute(PROFILE_A, INSTALLATION_1, {
      platform: 'ios',
      fcmToken: 'token-two',
    });

    expect(refreshed.lastSeenAt).toBe(LATER.toISOString());
    expect(refreshed.registeredAt).toBe(NOW.toISOString());
    const stored = [...first.fakes.devices.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.fcmToken).toBe('token-two');
  });

  it('reactivates a provider-disabled record — a fresh registration proves the channel works again', async () => {
    const { fakes, register } = createHarness();
    await register.execute(PROFILE_A, INSTALLATION_1, { platform: 'ios', fcmToken: 'token-one' });
    const device = [...fakes.devices.rows.values()][0];
    expect(device).toBeDefined();
    if (device !== undefined) {
      await fakes.devices.disable(device.id, 'token_invalid', NOW);
    }

    const resource = await register.execute(PROFILE_A, INSTALLATION_1, {
      platform: 'ios',
      fcmToken: 'token-fresh',
    });

    expect(resource.status).toBe('active');
    expect([...fakes.devices.rows.values()][0]?.disabledReason).toBeNull();
  });

  it("displaces another profile's record holding the same token — account switch on one physical device", async () => {
    const { fakes, register } = createHarness();
    await register.execute(PROFILE_A, INSTALLATION_1, {
      platform: 'ios',
      fcmToken: 'shared-device-token',
    });

    await register.execute(PROFILE_B, INSTALLATION_2, {
      platform: 'ios',
      fcmToken: 'shared-device-token',
    });

    const stored = [...fakes.devices.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      profileId: PROFILE_B,
      installationId: INSTALLATION_2,
      fcmToken: 'shared-device-token',
    });
  });
});

describe('RemoveNotificationDevice', () => {
  it("removes the caller's own record and converges on repeat — removal of an absent record is the same end state", async () => {
    const { fakes, register, remove } = createHarness();
    await register.execute(PROFILE_A, INSTALLATION_1, { platform: 'web', fcmToken: 'token-one' });

    await remove.execute(PROFILE_A, INSTALLATION_1);
    expect(fakes.devices.rows.size).toBe(0);

    // A retry (or a never-registered installation) is a clean no-op.
    await expect(remove.execute(PROFILE_A, INSTALLATION_1)).resolves.toBeUndefined();
  });

  it("never removes another profile's record for the same installation id", async () => {
    const { fakes, register, remove } = createHarness();
    await register.execute(PROFILE_A, INSTALLATION_1, { platform: 'ios', fcmToken: 'token-one' });

    await remove.execute(PROFILE_B, INSTALLATION_1);

    expect(fakes.devices.rows.size).toBe(1);
  });
});
