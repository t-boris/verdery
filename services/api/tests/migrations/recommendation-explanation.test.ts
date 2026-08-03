/**
 * Migration tests for the recommendation explanation column (P7-BE-01):
 * the nullable `explanation` on `recommendation_candidate`, its non-blank
 * CHECK, the presentable-explanation CHECK (a candidate cannot hold a
 * presentable-lineage state without its stored reason, while legacy
 * `generated`/`expired`/`superseded` rows admit NULL), and the down
 * migration's cleanup.
 *
 * Source: implementation-plan.md work package P7-BE-01;
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
import { rollbackDepthTo } from '../support/migration-rollback-depth.js';

const SUITE_NAME = 'recommendation explanation migration';

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
  let gardenId: string;
  let ruleVersionId: string;
  let legacyCandidateId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const profileId = randomUUID();
    gardenId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    ruleVersionId = randomUUID();
    await client.query(
      `INSERT INTO tasks_recommendations.rule_version (id, rule_key, version, safety_tier)
        VALUES ($1, 'watering.explanation-test', 1, 'ordinary_care')`,
      [ruleVersionId],
    );
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

  /** Candidate + one evidence row in ONE transaction — the deferred primary-evidence FK is checked at COMMIT. */
  async function insertCandidateWithEvidence(candidateOverrides: Row = {}): Promise<string> {
    const evidenceId = randomUUID();
    const candidateId = randomUUID();

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
        ...candidateOverrides,
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

  it('admits the legacy shape — a generated candidate without an explanation — and a NULL on expired/superseded', async () => {
    legacyCandidateId = await insertCandidateWithEvidence({ state: 'generated' });
    await insertCandidateWithEvidence({ state: 'expired' });
    await insertCandidateWithEvidence({ state: 'superseded' });

    const stored = await client.query<{ explanation: string | null }>(
      'SELECT explanation FROM tasks_recommendations.recommendation_candidate WHERE id = $1',
      [legacyCandidateId],
    );
    expect(stored.rows[0]?.explanation).toBeNull();
  });

  it('stores the explanation the engine writes on an eligible candidate', async () => {
    const candidateId = await insertCandidateWithEvidence({
      state: 'eligible',
      explanation: 'Recent dry weather suggests a watering check.',
    });

    const stored = await client.query<{ explanation: string | null }>(
      'SELECT explanation FROM tasks_recommendations.recommendation_candidate WHERE id = $1',
      [candidateId],
    );
    expect(stored.rows[0]?.explanation).toBe('Recent dry weather suggests a watering check.');
  });

  it('rejects a presentable-lineage state without a stored explanation — the CHECK that keeps Today honest', async () => {
    await expect(insertCandidateWithEvidence({ state: 'eligible' })).rejects.toThrow(
      /recommendation_candidate_presentable_explanation_check/,
    );
    await expect(
      insertCandidateWithEvidence({
        state: 'completed',
        presented_at: new Date('2026-07-25T09:00:00Z'),
      }),
    ).rejects.toThrow(/recommendation_candidate_presentable_explanation_check/);
  });

  it('rejects a blank explanation — an empty reason explains nothing', async () => {
    await expect(
      insertCandidateWithEvidence({ state: 'eligible', explanation: '' }),
    ).rejects.toThrow(/recommendation_candidate_explanation_not_blank_check/);
  });

  it('rolls back, dropping the column and both CHECKs while earlier rows survive', async () => {
    await client.end();

    // Undoes every migration applied after this one, then this one. The
    // depth is derived from the migrations directory, so a migration added
    // on top needs no edit here.
    await migrate(databaseUrl, 'down', rollbackDepthTo('recommendation-explanation'));

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const column = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tasks_recommendations'
          AND table_name = 'recommendation_candidate' AND column_name = 'explanation'`,
    );
    expect(column.rows).toHaveLength(0);

    const checks = await client.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = 'tasks_recommendations'
          AND table_name = 'recommendation_candidate'
          AND constraint_name IN (
            'recommendation_candidate_explanation_not_blank_check',
            'recommendation_candidate_presentable_explanation_check'
          )`,
    );
    expect(checks.rows).toHaveLength(0);

    const survivor = await client.query<{ state: string }>(
      'SELECT state FROM tasks_recommendations.recommendation_candidate WHERE id = $1',
      [legacyCandidateId],
    );
    expect(survivor.rows[0]?.state).toBe('generated');
  });
});
