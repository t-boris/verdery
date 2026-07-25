/**
 * Migration tests for the recommendations baseline (P7-DATA-01), core
 * half: rule versions, the deferred composite FK that makes an
 * evidence-free candidate physically impossible in a committed database
 * state, every candidate/evidence CHECK constraint, the structural
 * restricted-tier exclusion, same-garden single-successor supersession,
 * and the down migration's cleanup. The outcome-trail half (priority
 * factors, feedback, task conversion linkage, role privileges) lives in
 * `recommendations-baseline-outcomes.test.ts` — two suites for one
 * migration only because a single file would exceed the repository's
 * 600-line source limit.
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

const SUITE_NAME = 'recommendations baseline migration';

const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';

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
  let plantId: string;
  let ruleVersionId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
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

  const insertRuleVersion = (overrides: Row = {}) =>
    insertRow(
      'tasks_recommendations.rule_version',
      withId({
        rule_key: `watering.summer.${randomUUID()}`,
        version: 1,
        safety_tier: 'ordinary_care',
        ...overrides,
      }),
    );

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
    plantId = await insertRow(
      'plants_inventory.plant',
      withId({ garden_id: gardenId, display_name: 'Tomato #1', created_by_profile_id: profileId }),
    );
    ruleVersionId = await insertRuleVersion();
  }

  function candidateRow(overrides: Row = {}): Row {
    return withId({
      garden_id: gardenId,
      target_kind: 'garden',
      care_category: 'watering',
      rule_version_id: ruleVersionId,
      safety_tier: 'ordinary_care',
      primary_evidence_id: randomUUID(),
      ...overrides,
    });
  }

  function evidenceRow(candidateId: string, evidenceId: string, overrides: Row = {}): Row {
    return {
      id: evidenceId,
      candidate_id: candidateId,
      evidence_kind: 'garden_context',
      fact_key: 'garden.season',
      ...overrides,
    };
  }

  /**
   * Inserts a candidate together with one evidence row in ONE transaction —
   * the only way a candidate can come to exist, since the deferred
   * primary-evidence FK is checked at COMMIT. Returns both ids.
   */
  async function insertCandidateWithEvidence(
    candidateOverrides: Row = {},
    evidenceOverrides: Row = {},
  ): Promise<{ candidateId: string; evidenceId: string }> {
    const evidenceId = randomUUID();
    const row = candidateRow({ primary_evidence_id: evidenceId, ...candidateOverrides });
    const candidateId = row['id'] as string;

    await client.query('BEGIN');
    try {
      await insertRow('tasks_recommendations.recommendation_candidate', row);
      await insertRow(
        'tasks_recommendations.recommendation_evidence',
        evidenceRow(candidateId, evidenceId, evidenceOverrides),
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return { candidateId, evidenceId };
  }

  it('creates rule_version rows and enforces key, version, tier, and uniqueness', async () => {
    const ruleKey = `pruning.spring.${randomUUID()}`;
    const id = await insertRuleVersion({
      rule_key: ruleKey,
      version: 2,
      safety_tier: 'elevated_risk',
    });

    const row = await client.query<{ rule_key: string; version: number; safety_tier: string }>(
      'SELECT rule_key, version, safety_tier FROM tasks_recommendations.rule_version WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toEqual({ rule_key: ruleKey, version: 2, safety_tier: 'elevated_risk' });

    await expect(insertRuleVersion({ rule_key: '' })).rejects.toThrow(
      /rule_version_rule_key_check/,
    );
    await expect(insertRuleVersion({ version: 0 })).rejects.toThrow(
      /rule_version_version_positive_check/,
    );
    await expect(insertRuleVersion({ safety_tier: 'reviewed' })).rejects.toThrow(
      /rule_version_safety_tier_check/,
    );
    // Same key and version twice: rejected. A new version of the same key: fine.
    await expect(insertRuleVersion({ rule_key: ruleKey, version: 2 })).rejects.toThrow(
      /rule_version_rule_key_version_key/,
    );
    await insertRuleVersion({ rule_key: ruleKey, version: 3 });
  });

  it('makes an evidence-free candidate impossible: a bare insert fails at its implicit commit', async () => {
    await freshFoundation();

    await expect(
      insertRow('tasks_recommendations.recommendation_candidate', candidateRow()),
    ).rejects.toThrow(/recommendation_candidate_primary_evidence_fkey/);

    // The same insert inside an explicit transaction is accepted per
    // statement but the COMMIT itself is rejected — the deferred FK's
    // documented behavior, and the property the whole evidence guarantee
    // rests on.
    await client.query('BEGIN');
    await insertRow('tasks_recommendations.recommendation_candidate', candidateRow());
    await expect(client.query('COMMIT')).rejects.toThrow(
      /recommendation_candidate_primary_evidence_fkey/,
    );
  });

  it('accepts a candidate created atomically with its evidence, with the documented defaults', async () => {
    await freshFoundation();
    const { candidateId, evidenceId } = await insertCandidateWithEvidence();

    const row = await client.query<{
      state: string;
      urgency: string;
      revision: number;
      primary_evidence_id: string;
      supersedes_candidate_id: string | null;
      presented_at: Date | null;
      window_start: Date | null;
      window_end: Date | null;
    }>(
      `SELECT state, urgency, revision, primary_evidence_id, supersedes_candidate_id,
              presented_at, window_start, window_end
         FROM tasks_recommendations.recommendation_candidate WHERE id = $1`,
      [candidateId],
    );
    expect(row.rows[0]).toEqual({
      state: 'generated',
      urgency: 'normal',
      revision: 1,
      primary_evidence_id: evidenceId,
      supersedes_candidate_id: null,
      presented_at: null,
      window_start: null,
      window_end: null,
    });
  });

  it('rejects a candidate whose designated primary evidence belongs to a different candidate', async () => {
    await freshFoundation();
    const { evidenceId: foreignEvidenceId } = await insertCandidateWithEvidence();

    await client.query('BEGIN');
    await insertRow(
      'tasks_recommendations.recommendation_candidate',
      candidateRow({ primary_evidence_id: foreignEvidenceId }),
    );
    await expect(client.query('COMMIT')).rejects.toThrow(
      /recommendation_candidate_primary_evidence_fkey/,
    );
  });

  it('excludes restricted-tier rules structurally, and rejects a tier the rule does not carry', async () => {
    await freshFoundation();
    const restrictedRuleId = await insertRuleVersion({ safety_tier: 'restricted' });

    // A candidate honestly declaring its rule's restricted tier: the
    // generatable-tier CHECK stops it.
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({ rule_version_id: restrictedRuleId, safety_tier: 'restricted' }),
      ),
    ).rejects.toThrow(/recommendation_candidate_generatable_safety_tier_check/);

    // A candidate LYING about the tier to slip past the CHECK: the
    // composite FK stops it — the stored tier must be the rule's own.
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({ rule_version_id: restrictedRuleId, safety_tier: 'ordinary_care' }),
      ),
    ).rejects.toThrow(/recommendation_candidate_rule_version_fkey/);
  });

  it('enforces the candidate state, urgency, category, window, and target CHECKs', async () => {
    await freshFoundation();

    await expect(
      insertRow('tasks_recommendations.recommendation_candidate', candidateRow({ state: 'shown' })),
    ).rejects.toThrow(/recommendation_candidate_state_check/);
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({ urgency: 'critical' }),
      ),
    ).rejects.toThrow(/recommendation_candidate_urgency_check/);
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({ care_category: '' }),
      ),
    ).rejects.toThrow(/recommendation_candidate_care_category_check/);
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({
          window_start: new Date('2026-08-02T00:00:00Z'),
          window_end: new Date('2026-08-01T00:00:00Z'),
        }),
      ),
    ).rejects.toThrow(/recommendation_candidate_window_check/);
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({ target_kind: 'garden', target_plant_id: plantId }),
      ),
    ).rejects.toThrow(/recommendation_candidate_target_consistency_check/);
    await expect(
      insertRow(
        'tasks_recommendations.recommendation_candidate',
        candidateRow({ target_kind: 'garden_area' }),
      ),
    ).rejects.toThrow(/recommendation_candidate_target_consistency_check/);

    // A consistent plant target is accepted (with its evidence, as always).
    const { candidateId } = await insertCandidateWithEvidence({
      target_kind: 'plant',
      target_plant_id: plantId,
    });
    const row = await client.query<{ target_plant_id: string }>(
      'SELECT target_plant_id FROM tasks_recommendations.recommendation_candidate WHERE id = $1',
      [candidateId],
    );
    expect(row.rows[0]?.target_plant_id).toBe(plantId);
  });

  it('ties presented_at to the states that imply presentation', async () => {
    await freshFoundation();

    // Pre-presentation states must not carry the timestamp.
    await expect(
      insertCandidateWithEvidence({ state: 'eligible', presented_at: new Date() }),
    ).rejects.toThrow(/recommendation_candidate_presentation_timestamp_check/);
    // Post-presentation user outcomes must.
    await expect(insertCandidateWithEvidence({ state: 'completed' })).rejects.toThrow(
      /recommendation_candidate_presentation_timestamp_check/,
    );
    // expired/superseded are reachable from both sides, so both are legal.
    await insertCandidateWithEvidence({ state: 'expired' });
    await insertCandidateWithEvidence({ state: 'superseded', presented_at: new Date() });
    await insertCandidateWithEvidence({ state: 'presented', presented_at: new Date() });
  });

  it('enforces the evidence kind vocabulary, fact key, and per-kind reference consistency', async () => {
    await freshFoundation();
    const observationId = await insertRow(
      'observations_history.observation',
      withId({ garden_id: gardenId, created_by_profile_id: profileId, note_text: 'Wilting' }),
    );

    await expect(insertCandidateWithEvidence({}, { evidence_kind: 'hunch' })).rejects.toThrow(
      /recommendation_evidence_kind_check/,
    );
    await expect(insertCandidateWithEvidence({}, { fact_key: '' })).rejects.toThrow(
      /recommendation_evidence_fact_key_check/,
    );
    // A reference kind without its reference…
    await expect(insertCandidateWithEvidence({}, { evidence_kind: 'observation' })).rejects.toThrow(
      /recommendation_evidence_reference_consistency_check/,
    );
    // …a context kind with a stray reference…
    await expect(insertCandidateWithEvidence({}, { source_plant_id: plantId })).rejects.toThrow(
      /recommendation_evidence_reference_consistency_check/,
    );
    // …and each side done right.
    await insertCandidateWithEvidence(
      {},
      {
        evidence_kind: 'observation',
        source_observation_id: observationId,
        fact_key: 'observation.note',
      },
    );
    // Weather evidence carries its FK-less normalized-record id (the table
    // arrives with P7-INT-01 — see the migration's own comment).
    await insertCandidateWithEvidence(
      {},
      {
        evidence_kind: 'weather',
        source_weather_record_id: randomUUID(),
        fact_key: 'weather.rain',
      },
    );
  });

  it('keeps supersession same-garden, one successor per prior record, never self-referential', async () => {
    await freshFoundation();
    const { candidateId: priorId } = await insertCandidateWithEvidence();

    // Cross-garden supersession is physically impossible.
    const otherProfileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      otherProfileId,
      randomUUID(),
    ]);
    const otherGardenId = randomUUID();
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Elsewhere', $2)`,
      [otherGardenId, otherProfileId],
    );
    await expect(
      insertCandidateWithEvidence({
        garden_id: otherGardenId,
        supersedes_candidate_id: priorId,
      }),
    ).rejects.toThrow(/recommendation_candidate_supersedes_fkey/);

    // Self-supersession is rejected outright.
    const selfId = randomUUID();
    await expect(
      insertCandidateWithEvidence({ id: selfId, supersedes_candidate_id: selfId }),
    ).rejects.toThrow(/recommendation_candidate_no_self_supersession_check/);

    // A same-garden successor works, and the prior record can have only one.
    await insertCandidateWithEvidence({ supersedes_candidate_id: priorId });
    await expect(insertCandidateWithEvidence({ supersedes_candidate_id: priorId })).rejects.toThrow(
      /recommendation_candidate_supersedes_candidate_id_key/,
    );
  });

  it('rolls back, dropping the five recommendation tables and the task origin column', async () => {
    await freshFoundation();
    await insertCandidateWithEvidence();
    const survivingTaskId = await insertRow(
      'tasks_recommendations.task',
      withId({
        garden_id: gardenId,
        target_kind: 'garden',
        title: 'Water the whole garden',
        created_by_profile_id: profileId,
      }),
    );

    await client.end();

    // `count: 1`: this file tests the newest migration, so only itself is
    // undone — the position every newest-migration test starts from. When a
    // later migration lands on top, bump this (and the counts in every
    // earlier migration test) per the established ripple convention.
    await migrate(databaseUrl, 'down', 1);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'tasks_recommendations'
        ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'task',
      'task_attachment',
      'task_revision',
    ]);

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tasks_recommendations' AND table_name = 'task'
          AND column_name = 'origin_recommendation_id'`,
    );
    expect(columns.rows).toHaveLength(0);

    // The task row inserted above survives the rollback untouched.
    const survivingTask = await client.query<{ source: string }>(
      'SELECT source FROM tasks_recommendations.task WHERE id = $1',
      [survivingTaskId],
    );
    expect(survivingTask.rows[0]?.source).toBe('manual');
  });
});
