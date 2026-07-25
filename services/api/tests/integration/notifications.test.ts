/**
 * Full-stack integration tests for P7-NOTIF-01 against real PostgreSQL —
 * the work package's acceptance evidence ("Notification policy tests") at
 * the durable layer: the real unit of work, the real cross-schema
 * recipient/freshness sources, the real dedup index under a genuine
 * concurrent race, quiet-hours deferral with real zone math, durable
 * supersession and read-triggered expiry, the convergent inbox stamps'
 * raw-SQL update, and the revision-guarded preference document.
 */

import { randomUUID } from 'node:crypto';
import { RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE } from '@verdery/api-contracts';
import type { NotificationDomainEventEnvelope } from '@verdery/api-contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  ApplyNotificationPolicy,
  DismissNotification,
  GetNotificationPreferences,
  KyselyNotificationIntentRepository,
  KyselyNotificationsUnitOfWork,
  ListNotifications,
  MarkNotificationRead,
  UpdateNotificationPreferences,
} from '../../src/modules/notifications/public.js';
import {
  GardenAuthorization,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import { KyselyNotificationPreferenceRepository } from '../../src/modules/notifications/public.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'notifications integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

// 12:00Z: 21:00 in Tokyo — inside a 20:00-08:00 quiet window whose next
// end (08:00 Tokyo, UTC+9, no DST) is 23:00Z the same day.
const NOW = new Date('2026-07-20T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** A settable clock so one suite can walk time forward past expiries. */
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

  beforeAll(async () => {
    container = await startPostgresTestContainer();
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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(timeZone = 'UTC', accountState = 'active'): Promise<string> {
    const profileId = generateUuidV7();
    await db
      .insertInto('identity_access.profile')
      .values({
        id: profileId,
        firebase_uid: `firebase-${profileId}`,
        account_state: accountState,
        time_zone: timeZone,
      })
      .execute();
    return profileId;
  }

  async function insertGardenWithMembers(
    members: readonly { profileId: string; role?: string; state?: string }[],
  ): Promise<string> {
    const gardenId = generateUuidV7();
    const [owner] = members;
    if (owner === undefined) {
      throw new Error('at least one member required');
    }
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'Notification garden',
        lifecycle_state: 'active',
        created_by_profile_id: owner.profileId,
      })
      .execute();
    for (const member of members) {
      await db
        .insertInto('collaboration.membership')
        .values({
          id: randomUUID(),
          garden_id: gardenId,
          profile_id: member.profileId,
          role: member.role ?? 'owner',
          state: member.state ?? 'active',
        })
        .execute();
    }
    return gardenId;
  }

  /** Candidate + primary evidence in ONE transaction (the COMMIT-checked composite FK). */
  async function insertCandidate(
    gardenId: string,
    options: { state?: string; windowEnd?: Date | null; urgency?: string } = {},
  ): Promise<string> {
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
          state: options.state ?? 'eligible',
          urgency: options.urgency ?? 'normal',
          window_start: new Date(NOW.getTime() - DAY_MS),
          window_end:
            options.windowEnd === undefined
              ? new Date(NOW.getTime() + 5 * DAY_MS)
              : options.windowEnd,
          primary_evidence_id: evidenceId,
          supersedes_candidate_id: null,
          // The presentation-timestamp CHECK: presented-and-beyond states
          // carry the stamp, earlier states must not.
          presented_at: ['presented', 'completed', 'postponed', 'rejected'].includes(
            options.state ?? 'eligible',
          )
            ? new Date(NOW.getTime() - DAY_MS / 2)
            : null,
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

  function candidateEvent(
    gardenId: string,
    candidateId: string,
    overrides: Record<string, unknown> = {},
  ): NotificationDomainEventEnvelope {
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
        ...overrides,
      },
      traceId: null,
      occurredAt: NOW.toISOString(),
    };
  }

  it('fans one event out to every active member with per-recipient quiet-hours deferral, excluding removed members', async () => {
    clock.set(NOW);
    const utcMember = await insertProfile('UTC');
    const tokyoMember = await insertProfile('Asia/Tokyo');
    const removedMember = await insertProfile('UTC');
    const gardenId = await insertGardenWithMembers([
      { profileId: utcMember },
      { profileId: tokyoMember, role: 'viewer' },
      { profileId: removedMember, role: 'editor', state: 'removed' },
    ]);
    const candidateId = await insertCandidate(gardenId);

    // The Tokyo member holds a quiet-hours document written through the
    // real preference repository.
    await new KyselyNotificationPreferenceRepository(db).replaceDocument(
      tokyoMember,
      0,
      {
        quietHours: { startMinute: 20 * 60, endMinute: 8 * 60 },
        quietHoursTimeZone: null,
        entries: [],
      },
      NOW,
    );

    const summary = await applyPolicy.execute(candidateEvent(gardenId, candidateId));

    expect(summary).toMatchObject({
      recipientsConsidered: 2,
      intentsCreated: 2,
      intentsDeduplicated: 0,
      priorIntentsSuperseded: 0,
    });

    const rows = await db
      .selectFrom('notifications.notification_intent')
      .selectAll()
      .where('recommendation_candidate_id', '=', candidateId)
      .execute();
    expect(rows).toHaveLength(2);

    const utcRow = rows.find((row) => row.recipient_profile_id === utcMember);
    expect(utcRow?.earliest_delivery_at).toEqual(NOW);
    expect(utcRow?.state).toBe('pending');
    expect(utcRow?.expires_at).toEqual(new Date(NOW.getTime() + 5 * DAY_MS));

    // 21:00 Tokyo is inside 20:00-08:00; push defers to 08:00 Tokyo = 23:00Z.
    const tokyoRow = rows.find((row) => row.recipient_profile_id === tokyoMember);
    expect(tokyoRow?.earliest_delivery_at).toEqual(new Date('2026-07-20T23:00:00Z'));
  });

  it('collapses concurrent duplicate deliveries on the real unique index — one intent per recipient', async () => {
    clock.set(NOW);
    const member = await insertProfile();
    const gardenId = await insertGardenWithMembers([{ profileId: member }]);
    const candidateId = await insertCandidate(gardenId);
    const event = candidateEvent(gardenId, candidateId);

    const [first, second] = await Promise.all([
      applyPolicy.execute(event),
      applyPolicy.execute(event),
    ]);

    expect(first.intentsCreated + second.intentsCreated).toBe(1);
    expect(first.intentsDeduplicated + second.intentsDeduplicated).toBe(1);

    const count = await db
      .selectFrom('notifications.notification_intent')
      .select(db.fn.countAll<number>().as('rows'))
      .where('recommendation_candidate_id', '=', candidateId)
      .executeTakeFirstOrThrow();
    expect(Number(count.rows)).toBe(1);
  });

  it("closes the prior candidate's pending intents when a superseding event arrives", async () => {
    clock.set(NOW);
    const member = await insertProfile();
    const gardenId = await insertGardenWithMembers([{ profileId: member }]);
    const priorCandidate = await insertCandidate(gardenId);
    await applyPolicy.execute(candidateEvent(gardenId, priorCandidate));

    const newCandidate = await insertCandidate(gardenId);
    const summary = await applyPolicy.execute(
      candidateEvent(gardenId, newCandidate, { supersedesCandidateId: priorCandidate }),
    );

    expect(summary).toMatchObject({ intentsCreated: 1, priorIntentsSuperseded: 1 });

    const prior = await db
      .selectFrom('notifications.notification_intent')
      .select(['state', 'revision'])
      .where('recommendation_candidate_id', '=', priorCandidate)
      .executeTakeFirstOrThrow();
    expect(prior).toEqual({ state: 'superseded', revision: 2 });

    // The inbox lists only the replacement.
    const { result } = await listNotifications.execute(member, null, 50);
    expect(result.items.map((item) => item.recommendationCandidateId)).toEqual([newCandidate]);
  });

  it('suppresses a stale drained event end to end — no rows for a resolved candidate', async () => {
    clock.set(NOW);
    const member = await insertProfile();
    const gardenId = await insertGardenWithMembers([{ profileId: member }]);
    const candidateId = await insertCandidate(gardenId, { state: 'completed' });

    const summary = await applyPolicy.execute(candidateEvent(gardenId, candidateId));

    expect(summary.suppressed).toEqual({ candidate_not_live: 1 });
    const count = await db
      .selectFrom('notifications.notification_intent')
      .select(db.fn.countAll<number>().as('rows'))
      .where('recommendation_candidate_id', '=', candidateId)
      .executeTakeFirstOrThrow();
    expect(Number(count.rows)).toBe(0);
  });

  it('expires a pending intent durably through the inbox read once its window passes', async () => {
    clock.set(NOW);
    const member = await insertProfile();
    const gardenId = await insertGardenWithMembers([{ profileId: member }]);
    const windowEnd = new Date(NOW.getTime() + DAY_MS);
    const candidateId = await insertCandidate(gardenId, { windowEnd });
    await applyPolicy.execute(
      candidateEvent(gardenId, candidateId, { windowEnd: windowEnd.toISOString() }),
    );

    const before = await listNotifications.execute(member, null, 50);
    expect(before.result.items).toHaveLength(1);
    expect(before.intentsExpired).toBe(0);

    clock.set(new Date(windowEnd.getTime() + 1000));
    const after = await listNotifications.execute(member, null, 50);
    expect(after.intentsExpired).toBe(1);
    expect(after.result.items).toHaveLength(0);

    const row = await db
      .selectFrom('notifications.notification_intent')
      .select(['state', 'revision'])
      .where('recommendation_candidate_id', '=', candidateId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: 'expired', revision: 2 });
  });

  it('stamps read and dismissal convergently through the real single-statement update', async () => {
    clock.set(NOW);
    const member = await insertProfile();
    const gardenId = await insertGardenWithMembers([{ profileId: member }]);
    const candidateId = await insertCandidate(gardenId);
    await applyPolicy.execute(candidateEvent(gardenId, candidateId));

    const intents = new KyselyNotificationIntentRepository(db);
    const markRead = new MarkNotificationRead(intents, clock);
    const dismiss = new DismissNotification(intents, clock);

    const { result } = await listNotifications.execute(member, null, 50);
    const id = result.items[0]?.id ?? '';

    const first = await markRead.execute(id, member);
    clock.set(new Date(NOW.getTime() + 60_000));
    const repeat = await markRead.execute(id, member);
    expect(repeat.readAt).toBe(first.readAt);

    const dismissed = await dismiss.execute(id, member);
    expect(dismissed.dismissedAt).not.toBeNull();

    const row = await db
      .selectFrom('notifications.notification_intent')
      .select(['state', 'revision', 'read_at', 'dismissed_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    // Two real writes (read once, dismiss once), the repeat wrote nothing.
    expect(row.state).toBe('pending');
    expect(row.revision).toBe(3);
    expect(row.read_at).toEqual(NOW);
  });

  it('round-trips the preference document with real revision guards and applies it to the next event', async () => {
    clock.set(NOW);
    const member = await insertProfile();
    const gardenId = await insertGardenWithMembers([{ profileId: member }]);

    const unitOfWork = new KyselyNotificationsUnitOfWork(db, clock);
    const update = new UpdateNotificationPreferences(
      new KyselyIdempotencyStore(db, clock),
      unitOfWork,
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      clock,
    );
    const get = new GetNotificationPreferences(new KyselyNotificationPreferenceRepository(db));

    const written = await update.execute(
      member,
      0,
      {
        quietHours: null,
        entries: [
          {
            notificationType: 'care_recommendation',
            gardenId,
            inAppEnabled: false,
            pushEnabled: false,
          },
        ],
      },
      generateUuidV7(),
    );
    expect(written.revision).toBe(1);
    expect(await get.execute(member)).toEqual(written);

    // A stale write loses against the real revision guard.
    await expect(
      update.execute(member, 0, { quietHours: null, entries: [] }, generateUuidV7()),
    ).rejects.toThrow(/changed by another request/);

    // The stored garden-scoped opt-out suppresses the next event.
    const candidateId = await insertCandidate(gardenId);
    const summary = await applyPolicy.execute(candidateEvent(gardenId, candidateId));
    expect(summary).toMatchObject({
      intentsCreated: 0,
      suppressed: { channels_disabled: 1 },
    });
  });
});
