/**
 * Migration tests for the AI-explanation record table (P7-AI-01):
 * defaults and every CHECK (locale, provenance, packet shape, non-blank
 * text, the accepted-requires-text implication, the closed outcome
 * vocabulary), the (candidate, locale) uniqueness that converges
 * concurrent runs, the candidate FK, role privileges (`verdery_worker`
 * gets NOTHING), and the down migration's cleanup.
 *
 * Source: implementation-plan.md work package P7-AI-01;
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

const SUITE_NAME = 'recommendation AI explanation migration';

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
  let candidateId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const profileId = randomUUID();
    const gardenId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    const ruleVersionId = randomUUID();
    await client.query(
      `INSERT INTO tasks_recommendations.rule_version (id, rule_key, version, safety_tier)
        VALUES ($1, 'watering.ai-explanation-test', 1, 'ordinary_care')`,
      [ruleVersionId],
    );

    // One presentable candidate with its evidence in one transaction —
    // the deferred primary-evidence FK is checked at COMMIT.
    candidateId = randomUUID();
    const evidenceId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tasks_recommendations.recommendation_candidate
         (id, garden_id, target_kind, care_category, explanation, rule_version_id, safety_tier,
          state, primary_evidence_id)
       VALUES ($1, $2, 'garden', 'watering', 'Stored deterministic explanation.', $3,
               'ordinary_care', 'eligible', $4)`,
      [candidateId, gardenId, ruleVersionId, evidenceId],
    );
    await client.query(
      `INSERT INTO tasks_recommendations.recommendation_evidence
         (id, candidate_id, evidence_kind, fact_key)
       VALUES ($1, $2, 'garden_context', 'garden.season')`,
      [evidenceId, candidateId],
    );
    await client.query('COMMIT');
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertRecord(overrides: Row = {}): Promise<string> {
    const row: Row = {
      id: randomUUID(),
      candidate_id: candidateId,
      locale: 'en',
      provider_key: 'vertex-ai-explanation',
      model: 'gemini-test',
      prompt_template_version: 1,
      packet_fact_keys: JSON.stringify(['garden.season']),
      generated_text: 'A friendlier phrasing.',
      validation_outcome: 'accepted',
      ...overrides,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO tasks_recommendations.recommendation_ai_explanation
         (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  it('stores an accepted record with defaults, and a text-less provider verdict', async () => {
    const acceptedId = await insertRecord();
    const stored = await client.query<{ created_at: Date; validation_outcome: string }>(
      `SELECT created_at, validation_outcome
         FROM tasks_recommendations.recommendation_ai_explanation WHERE id = $1`,
      [acceptedId],
    );
    expect(stored.rows[0]?.validation_outcome).toBe('accepted');
    expect(stored.rows[0]?.created_at).toBeInstanceOf(Date);

    await insertRecord({
      locale: 'ru',
      generated_text: null,
      validation_outcome: 'provider_safety_blocked',
    });
  });

  it('enforces one verdict per (candidate, locale) — the concurrent-run convergence index', async () => {
    await expect(insertRecord()).rejects.toThrow(
      /recommendation_ai_explanation_candidate_locale_key/,
    );
    // ON CONFLICT DO NOTHING against the same index converges silently —
    // the repository's insertIfAbsent path.
    const result = await client.query(
      `INSERT INTO tasks_recommendations.recommendation_ai_explanation
         (id, candidate_id, locale, provider_key, model, prompt_template_version,
          packet_fact_keys, generated_text, validation_outcome)
       VALUES ($1, $2, 'en', 'vertex-ai-explanation', 'gemini-test', 1, $3, 'text', 'accepted')
       ON CONFLICT (candidate_id, locale) DO NOTHING`,
      [randomUUID(), candidateId, JSON.stringify(['garden.season'])],
    );
    expect(result.rowCount).toBe(0);
  });

  it('rejects every malformed shape its CHECKs guard', async () => {
    const fresh = randomUUID();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tasks_recommendations.recommendation_candidate
         (id, garden_id, target_kind, care_category, explanation, rule_version_id, safety_tier,
          state, primary_evidence_id)
       SELECT $1, garden_id, 'garden', 'watering', 'Reason.', rule_version_id, 'ordinary_care',
              'eligible', $2
         FROM tasks_recommendations.recommendation_candidate WHERE id = $3`,
      [fresh, randomUUID(), candidateId],
    );
    await client.query(
      `INSERT INTO tasks_recommendations.recommendation_evidence
         (id, candidate_id, evidence_kind, fact_key)
       SELECT primary_evidence_id, id, 'garden_context', 'garden.season'
         FROM tasks_recommendations.recommendation_candidate WHERE id = $1`,
      [fresh],
    );
    await client.query('COMMIT');

    const cases: readonly [string, Row, RegExp][] = [
      ['unknown locale', { locale: 'de' }, /recommendation_ai_explanation_locale_check/],
      ['blank provider', { provider_key: '' }, /recommendation_ai_explanation_provider_key_check/],
      ['blank model', { model: '' }, /recommendation_ai_explanation_model_check/],
      [
        'zero prompt version',
        { prompt_template_version: 0 },
        /recommendation_ai_explanation_prompt_version_check/,
      ],
      [
        'non-array packet',
        { packet_fact_keys: JSON.stringify({ key: 'x' }) },
        /recommendation_ai_explanation_packet_check/,
      ],
      [
        'empty packet',
        { packet_fact_keys: JSON.stringify([]) },
        /recommendation_ai_explanation_packet_check/,
      ],
      ['blank text', { generated_text: '' }, /recommendation_ai_explanation_text_not_blank_check/],
      [
        'unknown outcome',
        { validation_outcome: 'looked_fine' },
        /recommendation_ai_explanation_outcome_check/,
      ],
      [
        'accepted without text',
        { generated_text: null },
        /recommendation_ai_explanation_accepted_text_check/,
      ],
      ['unknown candidate', { candidate_id: randomUUID() }, /violates foreign key constraint/],
    ];
    for (const [, overrides, pattern] of cases) {
      await expect(insertRecord({ candidate_id: fresh, ...overrides })).rejects.toThrow(pattern);
    }
  });

  it('grants verdery_application row access and verdery_worker NOTHING', async () => {
    const grants = await client.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'tasks_recommendations'
          AND table_name = 'recommendation_ai_explanation'
          AND grantee IN ('verdery_application', 'verdery_worker')`,
    );
    const byGrantee = new Map<string, string[]>();
    for (const row of grants.rows) {
      byGrantee.set(row.grantee, [...(byGrantee.get(row.grantee) ?? []), row.privilege_type]);
    }
    expect(byGrantee.get('verdery_application')).toEqual(
      expect.arrayContaining(['SELECT', 'INSERT']),
    );
    expect(byGrantee.has('verdery_worker')).toBe(false);
  });

  it('rolls back, dropping the table while the candidate and its explanation survive', async () => {
    await client.end();

    // `count: 2` undoes the one newer migration
    // (1786200000000_notification-delivery.sql — notification-delivery
    // tables and intent alterations nothing this file's own assertions
    // check) first, then this migration itself. Update again the next
    // time a migration is added on top of that one.
    await migrate(databaseUrl, 'down', 4);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const table = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'tasks_recommendations'
          AND table_name = 'recommendation_ai_explanation'`,
    );
    expect(table.rows).toHaveLength(0);

    const survivor = await client.query<{ explanation: string }>(
      'SELECT explanation FROM tasks_recommendations.recommendation_candidate WHERE id = $1',
      [candidateId],
    );
    expect(survivor.rows[0]?.explanation).toBe('Stored deterministic explanation.');
  });
});
