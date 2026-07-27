/**
 * P9-QA-01, Batch B, Matrix 8 (DST) — notification quiet-hours sub-case.
 *
 * `services/api/src/modules/notifications/domain/quiet-hours.test.ts`
 * already pins `resolveEarliestDeliveryAt`'s own DST semantics exhaustively
 * as a PURE function (spring-forward gap and fall-back ambiguity, both
 * Europe/Berlin and America/New_York, hand-computed expected instants) —
 * this suite does not repeat that. `tests/integration/notifications.test.ts`
 * DOES run the real `ApplyNotificationPolicy` pipeline against real
 * PostgreSQL, but its own "quiet-hours deferral with real zone math" case
 * deliberately uses Asia/Tokyo (no daylight saving at all — see that file's
 * own comment on `NOW`) specifically to avoid DST math.
 *
 * The genuine gap this suite closes: nobody has ever run the FULL wired
 * pipeline — a real `identity_access.profile.time_zone`, a real
 * `notification_preference_document` row written and read back through
 * `KyselyNotificationPreferenceRepository`, the real
 * `ApplyNotificationPolicy` command, and the real persisted
 * `notification_intent.earliest_delivery_at` column — through an ACTUAL
 * DST transition. This proves no local-time dependency crept in anywhere
 * in the WIRING between those layers, not just in the isolated pure
 * function `quiet-hours.test.ts` already covers by hand.
 *
 * Transition dates match this codebase's own established convention
 * (`quiet-hours.test.ts`'s header): America/New_York springs forward
 * 2026-03-08 02:00->03:00 EST->EDT and falls back 2026-11-01 02:00->01:00
 * EDT->EST.
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
import '../../src/platform/database/pg-date-parser.js';
import {
  ApplyNotificationPolicy,
  KyselyNotificationPreferenceRepository,
  KyselyNotificationsUnitOfWork,
} from '../../src/modules/notifications/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'p9-qa-01 DST sweep: notification quiet hours (real pipeline)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NEW_YORK = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** A settable clock, the identical pattern `notifications.test.ts` uses. */
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
  let preferences: KyselyNotificationPreferenceRepository;

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

    clock = new SettableClock(new Date('2026-01-01T00:00:00Z'));
    const unitOfWork = new KyselyNotificationsUnitOfWork(db, clock);
    applyPolicy = new ApplyNotificationPolicy(unitOfWork, clock);
    preferences = new KyselyNotificationPreferenceRepository(db);
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(timeZone: string): Promise<string> {
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

  async function insertGardenWithOwner(ownerId: string): Promise<string> {
    const gardenId = generateUuidV7();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'DST garden',
        lifecycle_state: 'active',
        created_by_profile_id: ownerId,
      })
      .execute();
    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        profile_id: ownerId,
        role: 'owner',
        state: 'active',
      })
      .execute();
    return gardenId;
  }

  /** Candidate + primary evidence in one transaction — mirrors `notifications.test.ts`'s own identical helper. */
  async function insertCandidate(gardenId: string, now: Date): Promise<string> {
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
          window_start: new Date(now.getTime() - DAY_MS),
          window_end: new Date(now.getTime() + 5 * DAY_MS),
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

  function candidateEvent(
    gardenId: string,
    candidateId: string,
    now: Date,
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
        windowStart: new Date(now.getTime() - DAY_MS).toISOString(),
        windowEnd: new Date(now.getTime() + 5 * DAY_MS).toISOString(),
        supersedesCandidateId: null,
      },
      traceId: null,
      occurredAt: now.toISOString(),
    };
  }

  /** Sets up one recipient with real, persisted quiet hours and fires the real policy at `now`, returning the persisted intent row's `earliest_delivery_at`. */
  async function runPolicyAndReadEarliestDelivery(
    now: Date,
    quietHours: { readonly startMinute: number; readonly endMinute: number },
  ): Promise<Date | null> {
    const ownerId = await insertProfile(NEW_YORK);
    const gardenId = await insertGardenWithOwner(ownerId);

    // A real preference document, written through the real repository —
    // proving the round trip through Postgres (not a hand-built in-memory
    // `QuietHours` object) still yields the correct DST-aware instant.
    await preferences.replaceDocument(
      ownerId,
      0,
      { quietHours, quietHoursTimeZone: null, entries: [] },
      now,
    );

    clock.set(now);
    const candidateId = await insertCandidate(gardenId, now);
    const summary = await applyPolicy.execute(candidateEvent(gardenId, candidateId, now));
    expect(summary.intentsCreated).toBe(1);

    const row = await db
      .selectFrom('notifications.notification_intent')
      .select('earliest_delivery_at')
      .where('recommendation_candidate_id', '=', candidateId)
      .executeTakeFirstOrThrow();
    return row.earliest_delivery_at;
  }

  it('maps a quiet-hours end inside the New York spring-forward gap to just after the gap, through the real pipeline', async () => {
    // Window 00:00-02:30 local; 02:30 EST does not exist on 2026-03-08 (02:00
    // EST jumps to 03:00 EDT at 07:00Z). `now` = 01:30 EST (06:30Z), inside
    // the window. The pure function's own expectation (`quiet-hours.test.ts`):
    // delivery resolves to 03:30 EDT = 07:30Z, right after the gap.
    const now = new Date('2026-03-08T06:30:00Z');
    const earliestDeliveryAt = await runPolicyAndReadEarliestDelivery(now, {
      startMinute: 0,
      endMinute: 150,
    });
    expect(earliestDeliveryAt).toEqual(new Date('2026-03-08T07:30:00Z'));
  });

  it('picks the FIRST occurrence of an ambiguous New York fall-back end still ahead of now, through the real pipeline', async () => {
    // Window 00:30-01:30 local on 2026-11-01: 01:30 occurs twice (05:30Z
    // EDT, 06:30Z EST). `now` = 01:00 EDT (05:00Z) — the first occurrence is
    // still ahead, so delivery is 05:30Z, never a day later.
    const now = new Date('2026-11-01T05:00:00Z');
    const earliestDeliveryAt = await runPolicyAndReadEarliestDelivery(now, {
      startMinute: 30,
      endMinute: 90,
    });
    expect(earliestDeliveryAt).toEqual(new Date('2026-11-01T05:30:00Z'));
  });

  it('picks the SECOND occurrence of an ambiguous New York fall-back end once the first already passed, through the real pipeline', async () => {
    // Same window, `now` = 01:15 EST (06:15Z) — the repeated hour's second
    // pass. The first 01:30 (05:30Z) is already behind; the honest end is
    // the second occurrence, 06:30Z, only 15 minutes away.
    const now = new Date('2026-11-01T06:15:00Z');
    const earliestDeliveryAt = await runPolicyAndReadEarliestDelivery(now, {
      startMinute: 30,
      endMinute: 90,
    });
    expect(earliestDeliveryAt).toEqual(new Date('2026-11-01T06:30:00Z'));
  });
});
