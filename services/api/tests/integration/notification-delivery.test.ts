/**
 * Full-stack integration tests for P7-NOTIF-02 against real PostgreSQL —
 * the work package's acceptance evidence ("Invalid-token and stale-intent
 * tests") at the durable layer: the real unit of work, the real
 * `FOR UPDATE SKIP LOCKED` claim under a genuine concurrent race, durable
 * device disabling and append-only attempt records on an invalid-token
 * verdict, the send-time freshness recheck against the real candidate
 * row, quiet-hours re-deferral, the at-scale expiry close, and the unique
 * token index's displacement semantics.
 *
 * The FCM edge itself is `FakePushMessageSender` — the ONE fake in these
 * tests, at the port the adapter owns: a live send is unverifiable here
 * because no real device token exists anywhere (no app installs FCM yet;
 * deferred-capabilities.md records that boundary honestly).
 */

import { randomUUID } from 'node:crypto';
import { RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE } from '@verdery/api-contracts';
import type { NotificationDomainEventEnvelope } from '@verdery/api-contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  ApplyNotificationPolicy,
  KyselyNotificationsUnitOfWork,
  ListNotifications,
  RegisterNotificationDevice,
  RunNotificationDeliverySweep,
} from '../../src/modules/notifications/public.js';
import { FakePushMessageSender } from '../../src/modules/notifications/application/notification-test-doubles.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'notification delivery integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-20T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** A settable clock so one suite can walk time forward past deferrals and expiries. */
class SettableClock implements Clock {
  constructor(private at: Date) {}

  set(at: Date): void {
    this.at = at;
  }

  now(): Date {
    return this.at;
  }
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let clock: SettableClock;
  let applyPolicy: ApplyNotificationPolicy;
  let listNotifications: ListNotifications;
  let registerDevice: RegisterNotificationDevice;
  let sender: FakePushMessageSender;
  let sweep: RunNotificationDeliverySweep;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

    clock = new SettableClock(NOW);
    const unitOfWork = new KyselyNotificationsUnitOfWork(db, clock);
    applyPolicy = new ApplyNotificationPolicy(unitOfWork, clock);
    listNotifications = new ListNotifications(unitOfWork, clock);
    registerDevice = new RegisterNotificationDevice(unitOfWork, clock, 'development');
    sender = new FakePushMessageSender();
    sweep = new RunNotificationDeliverySweep(unitOfWork, sender, clock);
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(timeZone = 'UTC'): Promise<string> {
    const profileId = generateUuidV7();
    await db
      .insertInto('identity_access.profile')
      .values({
        id: profileId,
        firebase_uid: `firebase-${profileId}`,
        account_state: 'active',
        time_zone: timeZone,
      })
      .execute();
    return profileId;
  }

  async function insertGardenWithMember(profileId: string): Promise<string> {
    const gardenId = generateUuidV7();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'Delivery garden',
        lifecycle_state: 'active',
        created_by_profile_id: profileId,
      })
      .execute();
    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        profile_id: profileId,
        role: 'owner',
        state: 'active',
      })
      .execute();
    return gardenId;
  }

  /** Candidate + primary evidence in ONE transaction (the COMMIT-checked composite FK). */
  async function insertCandidate(gardenId: string): Promise<string> {
    const candidateId = generateUuidV7();
    const evidenceId = generateUuidV7();

    await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('tasks_recommendations.rule_version')
        .select('id')
        .where('rule_key', '=', 'observation.attention-reminder')
        .where('version', '=', 1)
        .executeTakeFirst();
      const ruleVersionId = existing?.id ?? generateUuidV7();
      if (existing === undefined) {
        await trx
          .insertInto('tasks_recommendations.rule_version')
          .values({
            id: ruleVersionId,
            rule_key: 'observation.attention-reminder',
            version: 1,
            safety_tier: 'ordinary_care',
          })
          .execute();
      }

      await trx
        .insertInto('tasks_recommendations.recommendation_candidate')
        .values({
          id: candidateId,
          garden_id: gardenId,
          target_kind: 'garden',
          target_garden_area_id: null,
          target_plant_id: null,
          care_category: 'observation',
          explanation: 'Seeded deterministic explanation.',
          rule_version_id: ruleVersionId,
          safety_tier: 'ordinary_care',
          state: 'eligible',
          urgency: 'normal',
          window_start: new Date(NOW.getTime() - DAY_MS),
          window_end: new Date(NOW.getTime() + 5 * DAY_MS),
          primary_evidence_id: evidenceId,
          supersedes_candidate_id: null,
          presented_at: null,
          revision: 2,
        })
        .execute();
      await trx
        .insertInto('tasks_recommendations.recommendation_evidence')
        .values({
          id: evidenceId,
          candidate_id: candidateId,
          evidence_kind: 'garden_context',
          source_observation_id: null,
          source_task_id: null,
          source_plant_id: null,
          source_weather_record_id: null,
          fact_key: 'garden.context',
          fact_value: sql`'{"seeded": true}'::jsonb`,
        })
        .execute();
    });

    return candidateId;
  }

  function candidateEvent(gardenId: string, candidateId: string): NotificationDomainEventEnvelope {
    return {
      id: generateUuidV7(),
      eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
      payload: {
        candidateId,
        gardenId,
        ruleKey: 'observation.attention-reminder',
        ruleVersion: 1,
        targetKind: 'garden',
        targetPlantId: null,
        targetGardenAreaMapObjectId: null,
        urgency: 'normal',
        priorityScore: 40,
        windowStart: new Date(NOW.getTime() - DAY_MS).toISOString(),
        windowEnd: new Date(NOW.getTime() + 5 * DAY_MS).toISOString(),
        supersedesCandidateId: null,
      },
      traceId: null,
      occurredAt: NOW.toISOString(),
    };
  }

  /** One deliverable world: member + garden + live candidate + pending intent (via the real policy) + one registered device. */
  async function seedDeliverableWorld(token: string): Promise<{
    profileId: string;
    gardenId: string;
    candidateId: string;
    intentId: string;
  }> {
    const profileId = await insertProfile();
    const gardenId = await insertGardenWithMember(profileId);
    const candidateId = await insertCandidate(gardenId);
    await applyPolicy.execute(candidateEvent(gardenId, candidateId));
    await registerDevice.execute(profileId, generateUuidV7(), { platform: 'ios', fcmToken: token });

    const intent = await db
      .selectFrom('notifications.notification_intent')
      .select('id')
      .where('recipient_profile_id', '=', profileId)
      .executeTakeFirstOrThrow();

    return { profileId, gardenId, candidateId, intentId: intent.id };
  }

  async function intentRow(intentId: string): Promise<{
    state: string;
    close_reason: string | null;
    delivery_attempt_count: number;
    next_delivery_attempt_at: Date | null;
  }> {
    return db
      .selectFrom('notifications.notification_intent')
      .select(['state', 'close_reason', 'delivery_attempt_count', 'next_delivery_attempt_at'])
      .where('id', '=', intentId)
      .executeTakeFirstOrThrow();
  }

  it('delivers end to end: policy-created intent, registered device, sweep send, durable sent state, attempt record, inbox still listing', async () => {
    clock.set(NOW);
    const { profileId, intentId } = await seedDeliverableWorld('e2e-token');

    const result = await sweep.execute();

    expect(result).toMatchObject({ intentsSent: 1, attemptOutcomes: { accepted: 1 } });
    expect(sender.sent.some((message) => message.token === 'e2e-token')).toBe(true);

    const row = await intentRow(intentId);
    expect(row.state).toBe('sent');
    expect(row.delivery_attempt_count).toBe(1);

    const attempts = await db
      .selectFrom('notifications.notification_delivery_attempt')
      .selectAll()
      .where('intent_id', '=', intentId)
      .execute();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'accepted', error_code: null });

    // "Push delivery success does not determine inbox state": the sent
    // entry still lists.
    const inbox = await listNotifications.execute(profileId, null, 10);
    expect(inbox.result.items).toHaveLength(1);

    // Terminal: a second sweep claims nothing for this intent.
    const again = await sweep.execute();
    expect(again.intentsClaimed).toBe(0);
  });

  it('INVALID TOKEN: disables the device durably with the typed reason, fails the intent, and a re-registration reactivates the channel', async () => {
    clock.set(NOW);
    const { profileId, intentId } = await seedDeliverableWorld('doomed-token');
    sender.scriptOutcome('doomed-token', {
      kind: 'token_invalid',
      errorCode: 'messaging/registration-token-not-registered',
    });

    const result = await sweep.execute();

    expect(result.devicesDisabled).toBe(1);
    expect(result.intentsFailed).toEqual({ all_tokens_invalid: 1 });

    const device = await db
      .selectFrom('notifications.notification_device')
      .selectAll()
      .where('profile_id', '=', profileId)
      .executeTakeFirstOrThrow();
    expect(device.status).toBe('disabled');
    expect(device.disabled_reason).toBe('token_invalid');

    const row = await intentRow(intentId);
    expect(row).toMatchObject({ state: 'failed', close_reason: 'all_tokens_invalid' });

    const attempt = await db
      .selectFrom('notifications.notification_delivery_attempt')
      .selectAll()
      .where('intent_id', '=', intentId)
      .executeTakeFirstOrThrow();
    expect(attempt).toMatchObject({
      outcome: 'token_invalid',
      error_code: 'messaging/registration-token-not-registered',
      device_id: device.id,
    });

    // The client refreshes its token: the same installation reactivates.
    const refreshed = await registerDevice.execute(profileId, device.installation_id, {
      platform: 'ios',
      fcmToken: 'fresh-token',
    });
    expect(refreshed.status).toBe('active');
  });

  it('STALE INTENT: a candidate superseded after intent creation skips at send time with the durable typed reason and no push', async () => {
    clock.set(NOW);
    const { candidateId, intentId } = await seedDeliverableWorld('stale-token');

    // The engine supersedes the candidate AFTER the intent was created —
    // no closing event reaches the notifications module; only the
    // send-time freshness recheck can catch it.
    await db
      .updateTable('tasks_recommendations.recommendation_candidate')
      .set({ state: 'superseded' })
      .where('id', '=', candidateId)
      .execute();

    const sentBefore = sender.sent.length;
    const result = await sweep.execute();

    expect(result.intentsSkipped).toEqual({ candidate_not_live: 1 });
    expect(sender.sent.length).toBe(sentBefore);
    expect(await intentRow(intentId)).toMatchObject({
      state: 'skipped',
      close_reason: 'candidate_not_live',
    });
  });

  it('claims exclusively under a genuine concurrent race: two simultaneous sweeps produce exactly one send', async () => {
    clock.set(NOW);
    const { intentId } = await seedDeliverableWorld('race-token');
    const concurrentSender = new FakePushMessageSender();
    const concurrentSweep = new RunNotificationDeliverySweep(
      new KyselyNotificationsUnitOfWork(db, clock),
      concurrentSender,
      clock,
    );

    const sentBefore = sender.sent.length;
    const [first, second] = await Promise.all([sweep.execute(), concurrentSweep.execute()]);

    const raceSends = [...sender.sent.slice(sentBefore), ...concurrentSender.sent].filter(
      (message) => message.token === 'race-token',
    );
    expect(raceSends).toHaveLength(1);
    expect(first.intentsSent + second.intentsSent).toBe(1);
    expect((await intentRow(intentId)).state).toBe('sent');
  });

  it('re-defers at send time when quiet hours were written after intent creation, then delivers once the window ends', async () => {
    clock.set(NOW);
    const { profileId, intentId } = await seedDeliverableWorld('deferred-token');

    // Quiet hours arrive AFTER the intent existed (its earliest delivery
    // already passed): 12:00Z sits inside 11:00-14:00 UTC.
    await db
      .insertInto('notifications.notification_preference_document')
      .values({
        profile_id: profileId,
        quiet_hours_start_minute: 11 * 60,
        quiet_hours_end_minute: 14 * 60,
        quiet_hours_time_zone: 'UTC',
      })
      .execute();

    const deferring = await sweep.execute();
    expect(deferring.intentsDeferred).toBe(1);
    const parked = await intentRow(intentId);
    expect(parked.state).toBe('pending');
    expect(parked.next_delivery_attempt_at).toEqual(new Date('2026-07-20T14:00:00Z'));
    expect(sender.sent.some((message) => message.token === 'deferred-token')).toBe(false);

    // Past the window's end the parked intent is due again and delivers.
    clock.set(new Date('2026-07-20T14:00:01Z'));
    const delivering = await sweep.execute();
    expect(delivering.intentsSent).toBe(1);
    expect((await intentRow(intentId)).state).toBe('sent');
    clock.set(NOW);
  });

  it('closes past-expiry pending intents at scale — the in-app-only inbox of a recipient who never reads it included', async () => {
    clock.set(NOW);
    const { intentId } = await seedDeliverableWorld('expiry-token');
    // Make it in-app-only and already lapsed: invisible to the claim, the
    // deferred P7-NOTIF-01 close's exact target.
    await db
      .updateTable('notifications.notification_intent')
      .set({ channel_push: false, expires_at: new Date(NOW.getTime() - 1000) })
      .where('id', '=', intentId)
      .execute();

    const result = await sweep.execute();

    expect(result.intentsExpired).toBe(1);
    expect((await intentRow(intentId)).state).toBe('expired');
  });

  it('displaces the previous holder when a token re-registers under another profile — the unique token index made semantic', async () => {
    clock.set(NOW);
    const firstProfile = await insertProfile();
    const secondProfile = await insertProfile();
    await registerDevice.execute(firstProfile, generateUuidV7(), {
      platform: 'ios',
      fcmToken: 'switched-device-token',
    });

    await registerDevice.execute(secondProfile, generateUuidV7(), {
      platform: 'ios',
      fcmToken: 'switched-device-token',
    });

    const holders = await db
      .selectFrom('notifications.notification_device')
      .select(['profile_id'])
      .where('fcm_token', '=', 'switched-device-token')
      .execute();
    expect(holders).toEqual([{ profile_id: secondProfile }]);
  });
});
