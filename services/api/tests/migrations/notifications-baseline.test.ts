/**
 * Migration tests for the notifications baseline (P7-NOTIF-01): the
 * `notification_intent` table (defaults, every CHECK, the per-recipient
 * deduplication uniqueness, the profile cascade), the preference entry
 * table (CHECKs and the NULLS NOT DISTINCT scope uniqueness), the
 * preference document table (quiet-hours CHECKs), the privilege posture
 * all three inherit from the `notifications` schema's default privileges,
 * and the down migration's cleanup.
 *
 * Source: implementation-plan.md work package P7-NOTIF-01;
 *         architecture/testing-strategy.md, section
 *         "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'notifications baseline migration';

const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

async function migrate(
  databaseUrl: string,
  direction: 'up' | 'down',
  count = Number.POSITIVE_INFINITY,
): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIRECTORY,
    direction,
    migrationsTable: 'pgmigrations',
    count,
    log: () => {},
  });
}

type Row = Record<string, unknown>;

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let gardenId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    profileId = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [profileId, `firebase-${profileId}`],
    );
    gardenId = randomUUID();
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id)
       VALUES ($1, 'Notification Garden', $2)`,
      [gardenId, profileId],
    );
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertRow(table: string, row: Row): Promise<void> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
  }

  function intentRow(overrides: Row = {}): Row {
    const candidateId = randomUUID();
    return {
      id: randomUUID(),
      intent_type: 'care_recommendation',
      recipient_profile_id: profileId,
      garden_id: gardenId,
      recommendation_candidate_id: candidateId,
      source_event_id: randomUUID(),
      template_key: 'care_recommendation.created.v1',
      template_parameters: JSON.stringify({ ruleKey: 'observation_reminder' }),
      priority: 'normal',
      channel_in_app: true,
      channel_push: true,
      deep_link: JSON.stringify({ kind: 'gardenToday', gardenId, candidateId }),
      dedup_key: `care_recommendation:candidate:${candidateId}`,
      earliest_delivery_at: new Date('2026-07-20T12:00:00Z'),
      expires_at: new Date('2026-07-27T12:00:00Z'),
      ...overrides,
    };
  }

  const insertIntent = (overrides: Row = {}) =>
    insertRow('notifications.notification_intent', intentRow(overrides));

  function preferenceRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      profile_id: profileId,
      garden_id: null,
      notification_type: `type-${randomUUID()}`,
      in_app_enabled: true,
      push_enabled: false,
      ...overrides,
    };
  }

  const insertPreference = (overrides: Row = {}) =>
    insertRow('notifications.notification_preference', preferenceRow(overrides));

  function documentRow(overrides: Row = {}): Row {
    return {
      profile_id: profileId,
      quiet_hours_start_minute: 1320,
      quiet_hours_end_minute: 420,
      quiet_hours_time_zone: 'Europe/Berlin',
      ...overrides,
    };
  }

  const insertDocument = (overrides: Row = {}) =>
    insertRow('notifications.notification_preference_document', documentRow(overrides));

  it('creates an intent with the documented defaults: pending, version 1, revision 1, unread', async () => {
    const id = randomUUID();
    await insertIntent({ id });

    const row = await client.query<{
      state: string;
      intent_version: number;
      revision: number;
      read_at: Date | null;
      dismissed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT state, intent_version, revision, read_at, dismissed_at, created_at
         FROM notifications.notification_intent WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      state: 'pending',
      intent_version: 1,
      revision: 1,
      read_at: null,
      dismissed_at: null,
    });
    expect(row.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it('enforces the intent vocabulary and content CHECKs', async () => {
    await expect(insertIntent({ intent_type: '' })).rejects.toThrow(
      /notification_intent_type_check/,
    );
    await expect(insertIntent({ intent_version: 0 })).rejects.toThrow(
      /notification_intent_version_positive_check/,
    );
    await expect(insertIntent({ template_key: '' })).rejects.toThrow(
      /notification_intent_template_key_check/,
    );
    await expect(insertIntent({ dedup_key: '' })).rejects.toThrow(
      /notification_intent_dedup_key_check/,
    );
    await expect(insertIntent({ priority: 'urgent' })).rejects.toThrow(
      /notification_intent_priority_check/,
    );
    // `sent` became legal with 1786200000000_notification-delivery.sql
    // (this suite runs at the full migration stack's top), so a state
    // outside BOTH stages' vocabularies probes the CHECK here.
    await expect(insertIntent({ state: 'vanished' })).rejects.toThrow(
      /notification_intent_state_check/,
    );
  });

  it('refuses an intent with no eligible channel — that is a suppression, never a row', async () => {
    await expect(insertIntent({ channel_in_app: false, channel_push: false })).rejects.toThrow(
      /notification_intent_channel_check/,
    );
  });

  it('requires the candidate linkage on care-recommendation intents only', async () => {
    await expect(insertIntent({ recommendation_candidate_id: null })).rejects.toThrow(
      /notification_intent_candidate_linkage_check/,
    );
    // A future non-recommendation type carries no linkage; the implication
    // antecedent names only the type that requires it.
    await insertIntent({ intent_type: 'some_future_type', recommendation_candidate_id: null });
  });

  it('collapses repeated deliveries per recipient through the dedup uniqueness, while other recipients keep their own row', async () => {
    const otherProfile = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [otherProfile, `firebase-${otherProfile}`],
    );
    const dedupKey = `care_recommendation:candidate:${randomUUID()}`;

    await insertIntent({ dedup_key: dedupKey });
    await expect(insertIntent({ dedup_key: dedupKey })).rejects.toThrow(
      /notification_intent_recipient_dedup_key/,
    );
    await insertIntent({ dedup_key: dedupKey, recipient_profile_id: otherProfile });
  });

  it('cascades a profile deletion onto its intents, entries, and document — the inbox leaves with the account', async () => {
    const doomedProfile = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [doomedProfile, `firebase-${doomedProfile}`],
    );
    await insertIntent({ recipient_profile_id: doomedProfile });
    await insertPreference({ profile_id: doomedProfile });
    await insertDocument({ profile_id: doomedProfile });

    await client.query('DELETE FROM identity_access.profile WHERE id = $1', [doomedProfile]);

    // `count(*)` reads back as a JS number through the global bigint parser
    // this suite imports.
    const remains = await client.query<{ intents: number; entries: number; documents: number }>(
      `SELECT
         (SELECT count(*) FROM notifications.notification_intent WHERE recipient_profile_id = $1) AS intents,
         (SELECT count(*) FROM notifications.notification_preference WHERE profile_id = $1) AS entries,
         (SELECT count(*) FROM notifications.notification_preference_document WHERE profile_id = $1) AS documents`,
      [doomedProfile],
    );
    expect(remains.rows[0]).toEqual({ intents: 0, entries: 0, documents: 0 });
  });

  it('enforces the preference-entry CHECKs, the garden FK, and one row per scope — global rows included', async () => {
    await expect(insertPreference({ notification_type: '' })).rejects.toThrow(
      /notification_preference_type_check/,
    );
    await expect(insertPreference({ garden_id: randomUUID() })).rejects.toThrow(
      /notification_preference_garden_id_fkey/,
    );

    const type = `type-${randomUUID()}`;
    await insertPreference({ notification_type: type });
    // NULLS NOT DISTINCT: a second GLOBAL row for the same type is a real
    // conflict, not two rows NULL semantics would allow.
    await expect(insertPreference({ notification_type: type })).rejects.toThrow(
      /notification_preference_scope_key/,
    );
    // The garden-scoped override coexists with the global row.
    await insertPreference({ notification_type: type, garden_id: gardenId });
    await expect(
      insertPreference({ notification_type: type, garden_id: gardenId }),
    ).rejects.toThrow(/notification_preference_scope_key/);
  });

  it('enforces the quiet-hours document CHECKs', async () => {
    await expect(
      insertDocument({ quiet_hours_start_minute: 1320, quiet_hours_end_minute: null }),
    ).rejects.toThrow(/notification_preference_document_quiet_hours_pairing_check/);
    await expect(
      insertDocument({ quiet_hours_start_minute: 1440, quiet_hours_end_minute: 420 }),
    ).rejects.toThrow(/notification_preference_document_quiet_hours_range_check/);
    await expect(
      insertDocument({ quiet_hours_start_minute: 300, quiet_hours_end_minute: 300 }),
    ).rejects.toThrow(/notification_preference_document_quiet_hours_range_check/);
    await expect(
      insertDocument({
        quiet_hours_start_minute: null,
        quiet_hours_end_minute: null,
        quiet_hours_time_zone: 'Europe/Berlin',
      }),
    ).rejects.toThrow(/notification_preference_document_zone_requires_window_check/);
    await expect(insertDocument({ quiet_hours_time_zone: '' })).rejects.toThrow(
      /notification_preference_document_zone_not_blank_check/,
    );

    // A document with no quiet hours at all is legal (entries-only writes).
    const bareProfile = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [bareProfile, `firebase-${bareProfile}`],
    );
    await insertDocument({
      profile_id: bareProfile,
      quiet_hours_start_minute: null,
      quiet_hours_end_minute: null,
      quiet_hours_time_zone: null,
    });
  });

  it('grants verdery_application row access via the schema default privileges, and verdery_worker nothing', async () => {
    const result = await client.query<{
      app_intent_insert: boolean;
      app_intent_update: boolean;
      app_preference_select: boolean;
      worker_intent_select: boolean;
      worker_document_select: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_application', 'notifications.notification_intent', 'INSERT') AS app_intent_insert,
         has_table_privilege('verdery_application', 'notifications.notification_intent', 'UPDATE') AS app_intent_update,
         has_table_privilege('verdery_application', 'notifications.notification_preference', 'SELECT') AS app_preference_select,
         has_table_privilege('verdery_worker', 'notifications.notification_intent', 'SELECT') AS worker_intent_select,
         has_table_privilege('verdery_worker', 'notifications.notification_preference_document', 'SELECT') AS worker_document_select`,
    );

    expect(result.rows[0]).toEqual({
      app_intent_insert: true,
      app_intent_update: true,
      app_preference_select: true,
      // The relay forwards events to the API; no worker reads notification
      // rows — see the migration's header comment.
      worker_intent_select: false,
      worker_document_select: false,
    });
  });

  it('rolls back, dropping the notifications schema whole while every earlier table survives', async () => {
    await client.end();

    // `count: 3` undoes the two newer migrations
    // (1786200000000_notification-delivery.sql — this schema's OWN
    // delivery tables and intent alterations, which must leave before the
    // baseline can — and 1786100000000_recommendation-ai-explanation.sql,
    // a tasks_recommendations table nothing this file's own assertions
    // check) first, then this migration itself. Update again the next
    // time a migration is added on top of those.
    await migrate(databaseUrl, 'down', 4);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const schema = await client.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'notifications'`,
    );
    expect(schema.rows).toHaveLength(0);

    // The previous migration's tables survive untouched.
    const surviving = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'integrations'
        ORDER BY table_name`,
    );
    expect(surviving.rows.map((row) => row.table_name)).toEqual([
      'plant_content_record',
      'plant_taxonomy_mapping',
      'provider_quota_usage',
      'weather_record',
    ]);

    // The profile and garden this suite anchored to survive.
    const anchors = await client.query<{ profiles: number; gardens: number }>(
      `SELECT
         (SELECT count(*) FROM identity_access.profile WHERE id = $1) AS profiles,
         (SELECT count(*) FROM gardens_mapping.garden WHERE id = $2) AS gardens`,
      [profileId, gardenId],
    );
    expect(anchors.rows[0]).toEqual({ profiles: 1, gardens: 1 });
  });
});
