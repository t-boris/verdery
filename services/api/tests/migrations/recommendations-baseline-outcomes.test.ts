/**
 * Migration tests for the recommendations baseline (P7-DATA-01), outcome
 * half: priority factors, the append-only feedback trail, the completed
 * `task.origin_recommendation_id` deferral, and role privileges. The core
 * half (rule versions, evidence enforcement, candidate CHECKs,
 * supersession, rollback) lives in `recommendations-baseline.test.ts`,
 * whose header explains the two-file split; the candidate/evidence
 * scaffolding is repeated here the same way every migration test in this
 * directory self-contains its own fixtures.
 *
 * Source: implementation-plan.md work package P7-DATA-01;
 *         architecture/testing-strategy.md, section
 *         "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'recommendations baseline migration, outcome half';

const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';

const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

type Row = Record<string, unknown>;

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let profileId: string;
  let gardenId: string;
  let ruleVersionId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();

    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertRow(table: string, row: Row): Promise<string> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  function withId(row: Row): Row {
    return { id: randomUUID(), ...row };
  }

  async function freshFoundation(): Promise<void> {
    profileId = randomUUID();
    gardenId = randomUUID();

    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    ruleVersionId = await insertRow(
      'tasks_recommendations.rule_version',
      withId({
        rule_key: `watering.summer.${randomUUID()}`,
        version: 1,
        safety_tier: 'ordinary_care',
      }),
    );
  }

  /** Candidate plus one evidence row in ONE transaction — the only way past the deferred primary-evidence FK; see the core half's own test of that mechanism. */
  async function insertCandidateWithEvidence(): Promise<string> {
    const candidateId = randomUUID();
    const evidenceId = randomUUID();

    await client.query('BEGIN');
    try {
      await insertRow('tasks_recommendations.recommendation_candidate', {
        id: candidateId,
        garden_id: gardenId,
        target_kind: 'garden',
        care_category: 'watering',
        rule_version_id: ruleVersionId,
        safety_tier: 'ordinary_care',
        primary_evidence_id: evidenceId,
      });
      await insertRow('tasks_recommendations.recommendation_evidence', {
        id: evidenceId,
        candidate_id: candidateId,
        evidence_kind: 'garden_context',
        fact_key: 'garden.season',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return candidateId;
  }

  it('enforces the priority-factor vocabulary, value, and one-row-per-kind uniqueness', async () => {
    await freshFoundation();
    const candidateId = await insertCandidateWithEvidence();

    const insertFactor = (overrides: Row = {}) =>
      insertRow(
        'tasks_recommendations.recommendation_priority_factor',
        withId({
          candidate_id: candidateId,
          factor_kind: 'urgency_window',
          factor_value: JSON.stringify({ daysRemaining: 2 }),
          ...overrides,
        }),
      );

    await insertFactor();
    await expect(insertFactor()).rejects.toThrow(
      /recommendation_priority_factor_candidate_kind_key/,
    );
    await insertFactor({ factor_kind: 'confidence', factor_value: JSON.stringify('high') });
    await expect(insertFactor({ factor_kind: 'vibes' })).rejects.toThrow(
      /recommendation_priority_factor_kind_check/,
    );
    await expect(insertFactor({ factor_kind: 'plant_impact', factor_value: null })).rejects.toThrow(
      /null value in column "factor_value"/,
    );
  });

  it('records feedback with actor and timestamp, and ties postponed_until to postponed feedback', async () => {
    await freshFoundation();
    const candidateId = await insertCandidateWithEvidence();

    const insertFeedback = (overrides: Row = {}) =>
      insertRow(
        'tasks_recommendations.recommendation_feedback',
        withId({
          candidate_id: candidateId,
          feedback_kind: 'completed',
          actor_profile_id: profileId,
          ...overrides,
        }),
      );

    const feedbackId = await insertFeedback();
    const row = await client.query<{ feedback_kind: string; actor_profile_id: string }>(
      `SELECT feedback_kind, actor_profile_id
         FROM tasks_recommendations.recommendation_feedback WHERE id = $1`,
      [feedbackId],
    );
    expect(row.rows[0]).toEqual({ feedback_kind: 'completed', actor_profile_id: profileId });

    await insertFeedback({ feedback_kind: 'postponed', postponed_until: new Date() });
    await insertFeedback({ feedback_kind: 'irrelevant' });
    await expect(insertFeedback({ feedback_kind: 'snoozed' })).rejects.toThrow(
      /recommendation_feedback_kind_check/,
    );
    await expect(
      insertFeedback({ feedback_kind: 'dismissed', postponed_until: new Date() }),
    ).rejects.toThrow(/recommendation_feedback_postponed_until_check/);
    await expect(insertFeedback({ actor_profile_id: randomUUID() })).rejects.toThrow(
      /recommendation_feedback_actor_profile_id_fkey/,
    );
  });

  it('completes the deferred task.origin_recommendation_id: suggested tasks carry it, manual tasks cannot', async () => {
    await freshFoundation();
    const candidateId = await insertCandidateWithEvidence();

    const insertTask = (overrides: Row = {}) =>
      insertRow(
        'tasks_recommendations.task',
        withId({
          garden_id: gardenId,
          target_kind: 'garden',
          title: 'Water the whole garden',
          created_by_profile_id: profileId,
          ...overrides,
        }),
      );

    // The conversion shape P7-BE-01 will write: suggested + origin.
    const suggestedId = await insertTask({
      source: 'suggested',
      origin_recommendation_id: candidateId,
    });
    const row = await client.query<{ origin_recommendation_id: string }>(
      'SELECT origin_recommendation_id FROM tasks_recommendations.task WHERE id = $1',
      [suggestedId],
    );
    expect(row.rows[0]?.origin_recommendation_id).toBe(candidateId);

    // A manual task claiming a recommendation origin, and a suggested task
    // without one, both violate the equivalence CHECK.
    await expect(insertTask({ origin_recommendation_id: candidateId })).rejects.toThrow(
      /task_origin_recommendation_consistency_check/,
    );
    await expect(insertTask({ source: 'suggested' })).rejects.toThrow(
      /task_origin_recommendation_consistency_check/,
    );
    // And the reference must be real.
    await expect(
      insertTask({ source: 'suggested', origin_recommendation_id: randomUUID() }),
    ).rejects.toThrow(/task_origin_recommendation_id_fkey/);
  });

  it('grants verdery_application row access via default privileges, and verdery_worker nothing', async () => {
    const result = await client.query<{
      app_candidate_select: boolean;
      app_candidate_insert: boolean;
      app_evidence_insert: boolean;
      app_feedback_insert: boolean;
      worker_candidate_select: boolean;
      worker_evidence_select: boolean;
      worker_rule_version_select: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_application', 'tasks_recommendations.recommendation_candidate', 'SELECT') AS app_candidate_select,
         has_table_privilege('verdery_application', 'tasks_recommendations.recommendation_candidate', 'INSERT') AS app_candidate_insert,
         has_table_privilege('verdery_application', 'tasks_recommendations.recommendation_evidence', 'INSERT') AS app_evidence_insert,
         has_table_privilege('verdery_application', 'tasks_recommendations.recommendation_feedback', 'INSERT') AS app_feedback_insert,
         has_table_privilege('verdery_worker', 'tasks_recommendations.recommendation_candidate', 'SELECT') AS worker_candidate_select,
         has_table_privilege('verdery_worker', 'tasks_recommendations.recommendation_evidence', 'SELECT') AS worker_evidence_select,
         has_table_privilege('verdery_worker', 'tasks_recommendations.rule_version', 'SELECT') AS worker_rule_version_select`,
    );

    expect(result.rows[0]).toEqual({
      app_candidate_select: true,
      app_candidate_insert: true,
      app_evidence_insert: true,
      app_feedback_insert: true,
      // No worker touches recommendations yet — P7-ASYNC-01 grants what its
      // relay needs when it exists; see the migration's own header comment.
      worker_candidate_select: false,
      worker_evidence_select: false,
      worker_rule_version_select: false,
    });
  });
});
