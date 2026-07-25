/**
 * Migration tests for notification delivery (P7-NOTIF-02): the
 * `notification_device` table (every CHECK, the installation and token
 * uniqueness, the profile cascade), the append-only
 * `notification_delivery_attempt` table (outcome/error CHECKs, the intent
 * cascade), the intent table's delivery columns and extended state
 * vocabulary, the privilege posture (`verdery_worker` still gets
 * NOTHING), and the down migration's restoration of the P7-NOTIF-01
 * world — delivery-outcome rows coerced back to `pending`.
 *
 * Source: implementation-plan.md work package P7-NOTIF-02;
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

const SUITE_NAME = 'notification delivery migration';

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
  let anchorIntentId: string;

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
       VALUES ($1, 'Delivery Garden', $2)`,
      [gardenId, profileId],
    );
    anchorIntentId = randomUUID();
    await insertIntent({ id: anchorIntentId });
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

  function deviceRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      profile_id: profileId,
      installation_id: randomUUID(),
      platform: 'ios',
      provider: 'fcm',
      fcm_token: `token-${randomUUID()}`,
      environment: 'development',
      last_seen_at: new Date('2026-07-20T12:00:00Z'),
      ...overrides,
    };
  }

  const insertDevice = (overrides: Row = {}) =>
    insertRow('notifications.notification_device', deviceRow(overrides));

  function attemptRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      intent_id: anchorIntentId,
      device_id: randomUUID(),
      outcome: 'accepted',
      error_code: null,
      attempted_at: new Date('2026-07-20T12:01:00Z'),
      ...overrides,
    };
  }

  const insertAttempt = (overrides: Row = {}) =>
    insertRow('notifications.notification_delivery_attempt', attemptRow(overrides));

  it('creates a device with the documented defaults: active, no disabled reason', async () => {
    const id = randomUUID();
    await insertDevice({ id });

    const row = await client.query<{ status: string; disabled_reason: string | null }>(
      `SELECT status, disabled_reason FROM notifications.notification_device WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: 'active', disabled_reason: null });
  });

  it('enforces the device vocabulary and content CHECKs', async () => {
    await expect(insertDevice({ platform: 'android' })).rejects.toThrow(
      /notification_device_platform_check/,
    );
    await expect(insertDevice({ provider: '' })).rejects.toThrow(
      /notification_device_provider_check/,
    );
    await expect(insertDevice({ fcm_token: '' })).rejects.toThrow(
      /notification_device_token_check/,
    );
    await expect(insertDevice({ environment: 'qa' })).rejects.toThrow(
      /notification_device_environment_check/,
    );
    await expect(insertDevice({ status: 'revoked' })).rejects.toThrow(
      /notification_device_status_check/,
    );
    // A reason exists exactly when disabled — both directions.
    await expect(insertDevice({ disabled_reason: 'token_invalid' })).rejects.toThrow(
      /notification_device_disabled_reason_scope_check/,
    );
    await expect(insertDevice({ status: 'disabled' })).rejects.toThrow(
      /notification_device_disabled_reason_scope_check/,
    );
    await insertDevice({ status: 'disabled', disabled_reason: 'token_invalid' });
  });

  it('enforces one record per installation per profile, and one holder per token globally', async () => {
    const installationId = randomUUID();
    await insertDevice({ installation_id: installationId });
    await expect(insertDevice({ installation_id: installationId })).rejects.toThrow(
      /notification_device_installation_key/,
    );

    const otherProfile = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [otherProfile, `firebase-${otherProfile}`],
    );
    const token = `token-${randomUUID()}`;
    await insertDevice({ fcm_token: token });
    // Another profile cannot hold the same token — registration displaces
    // instead (the application's own two-statement transaction).
    await expect(insertDevice({ fcm_token: token, profile_id: otherProfile })).rejects.toThrow(
      /notification_device_token_key/,
    );
  });

  it('cascades a profile deletion onto its devices — tokens leave with the account', async () => {
    const doomedProfile = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [doomedProfile, `firebase-${doomedProfile}`],
    );
    await insertDevice({ profile_id: doomedProfile });

    await client.query('DELETE FROM identity_access.profile WHERE id = $1', [doomedProfile]);

    const remains = await client.query<{ devices: number }>(
      `SELECT count(*) AS devices FROM notifications.notification_device WHERE profile_id = $1`,
      [doomedProfile],
    );
    expect(remains.rows[0]).toEqual({ devices: 0 });
  });

  it('enforces the attempt outcome taxonomy and the error-code pairing', async () => {
    await insertAttempt();
    await insertAttempt({ outcome: 'token_invalid', error_code: 'messaging/x' });

    // An error code accompanies the bogus outcome so the VOCABULARY check
    // is the one that fires (a non-accepted outcome requires a code).
    await expect(
      insertAttempt({ outcome: 'delivered', error_code: 'messaging/x' }),
    ).rejects.toThrow(/notification_delivery_attempt_outcome_check/);
    await expect(insertAttempt({ error_code: '' })).rejects.toThrow(
      /notification_delivery_attempt_error_code_not_blank_check|notification_delivery_attempt_error_code_scope_check/,
    );
    // Accepted carries no error; every failure names one.
    await expect(insertAttempt({ error_code: 'messaging/x' })).rejects.toThrow(
      /notification_delivery_attempt_error_code_scope_check/,
    );
    await expect(insertAttempt({ outcome: 'transient_failure', error_code: null })).rejects.toThrow(
      /notification_delivery_attempt_error_code_scope_check/,
    );
  });

  it('cascades an intent deletion onto its attempts, while device_id is deliberately FK-free', async () => {
    const intentId = randomUUID();
    await insertIntent({ id: intentId });
    // No device row exists for this id at all — append-only audit outlives
    // revoked devices.
    await insertAttempt({ intent_id: intentId, device_id: randomUUID() });

    await client.query('DELETE FROM notifications.notification_intent WHERE id = $1', [intentId]);

    const remains = await client.query<{ attempts: number }>(
      `SELECT count(*) AS attempts FROM notifications.notification_delivery_attempt
        WHERE intent_id = $1`,
      [intentId],
    );
    expect(remains.rows[0]).toEqual({ attempts: 0 });
  });

  it('extends the intent state vocabulary with the delivery outcomes and scopes close_reason to failed/skipped', async () => {
    await insertIntent({ state: 'sent' });
    await insertIntent({ state: 'skipped', close_reason: 'candidate_not_live' });
    await insertIntent({ state: 'failed', close_reason: 'all_tokens_invalid' });

    await expect(insertIntent({ state: 'vanished' })).rejects.toThrow(
      /notification_intent_state_check/,
    );
    await expect(insertIntent({ close_reason: '' })).rejects.toThrow(
      /notification_intent_close_reason_not_blank_check|notification_intent_close_reason_scope_check/,
    );
    await expect(insertIntent({ state: 'sent', close_reason: 'why' })).rejects.toThrow(
      /notification_intent_close_reason_scope_check/,
    );
    await expect(insertIntent({ delivery_attempt_count: -1 })).rejects.toThrow(
      /notification_intent_attempt_count_check/,
    );
  });

  it('defaults the delivery columns to the never-claimed state', async () => {
    const id = randomUUID();
    await insertIntent({ id });

    const row = await client.query<{
      next_delivery_attempt_at: Date | null;
      delivery_attempt_count: number;
      close_reason: string | null;
    }>(
      `SELECT next_delivery_attempt_at, delivery_attempt_count, close_reason
         FROM notifications.notification_intent WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({
      next_delivery_attempt_at: null,
      delivery_attempt_count: 0,
      close_reason: null,
    });
  });

  it('grants verdery_application row access via the schema default privileges, and verdery_worker nothing', async () => {
    const result = await client.query<{
      app_device_insert: boolean;
      app_attempt_insert: boolean;
      worker_device_select: boolean;
      worker_attempt_select: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_application', 'notifications.notification_device', 'INSERT') AS app_device_insert,
         has_table_privilege('verdery_application', 'notifications.notification_delivery_attempt', 'INSERT') AS app_attempt_insert,
         has_table_privilege('verdery_worker', 'notifications.notification_device', 'SELECT') AS worker_device_select,
         has_table_privilege('verdery_worker', 'notifications.notification_delivery_attempt', 'SELECT') AS worker_attempt_select`,
    );

    expect(result.rows[0]).toEqual({
      app_device_insert: true,
      app_attempt_insert: true,
      // Tokens are secrets and the sweep runs in services/api — the worker
      // process never reads notification rows (the migration's header).
      worker_device_select: false,
      worker_attempt_select: false,
    });
  });

  it('rolls back to the P7-NOTIF-01 world: delivery tables gone, delivery-outcome rows honestly pending again', async () => {
    const sentId = randomUUID();
    await insertIntent({ id: sentId, state: 'sent' });

    await client.end();

    // `count: 1` undoes only this migration — it is the newest one.
    // Update the count the next time a migration is added on top.
    await migrate(databaseUrl, 'down', 3);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'notifications'
        ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'notification_intent',
      'notification_preference',
      'notification_preference_document',
    ]);

    // The delivery-outcome row was coerced back to the only honest
    // pre-delivery state, and the delivery columns are gone.
    const coerced = await client.query<{ state: string }>(
      `SELECT state FROM notifications.notification_intent WHERE id = $1`,
      [sentId],
    );
    expect(coerced.rows[0]).toEqual({ state: 'pending' });

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'notifications' AND table_name = 'notification_intent'
          AND column_name IN ('close_reason', 'delivery_attempt_count', 'next_delivery_attempt_at')`,
    );
    expect(columns.rows).toHaveLength(0);

    // The restored CHECK refuses the delivery vocabulary again.
    await expect(insertIntent({ state: 'sent' })).rejects.toThrow(
      /notification_intent_state_check/,
    );
  });
});
