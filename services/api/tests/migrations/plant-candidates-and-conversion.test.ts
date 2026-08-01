/**
 * Migration tests for P11-DATA-01
 * (`migrations/1787600000000_plant-candidates-and-conversion.sql`):
 * `plant_candidate`, `candidate_conversion`, and
 * `candidate_suitability_assessment` — table shape, CHECK constraints, the
 * at-most-one-conversion-per-candidate uniqueness guard, application-role
 * grants, and that `down` genuinely reverses `up` — mirrors
 * `taxonomy-seasonal-facts-and-bed-history.test.ts`'s structure for a
 * purely additive, no-prior-data migration.
 *
 * Source: implementation-plan.md work package P11-DATA-01;
 *         architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plant candidates and conversion migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let gardenId: string;
  let profileId: string;

  async function migrate(direction: 'up' | 'down', count: number): Promise<void> {
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction,
      migrationsTable: 'pgmigrations',
      count,
      log: () => {},
    });
  }

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    await migrate('up', Number.POSITIVE_INFINITY);

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    gardenId = randomUUID();
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Test Garden', $2)`,
      [gardenId, profileId],
    );
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertCandidate(overrides: {
    id?: string;
    status?: string;
    groupingKind?: string;
    quantity?: number | null;
    priority?: string | null;
    priceAmount?: number | null;
    priceCurrency?: string | null;
    alternativeToCandidateId?: string | null;
  }): Promise<string> {
    const {
      id = randomUUID(),
      status = 'active',
      groupingKind = 'individual',
      quantity = null,
      priority = null,
      priceAmount = null,
      priceCurrency = null,
      alternativeToCandidateId = null,
    } = overrides;

    await client.query(
      `INSERT INTO plants_inventory.plant_candidate
         (id, garden_id, display_name, grouping_kind, quantity, status, priority,
          price_amount, price_currency, alternative_to_candidate_id, created_by_profile_id)
       VALUES ($1, $2, 'Candidate Tomato', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        gardenId,
        groupingKind,
        quantity,
        status,
        priority,
        priceAmount,
        priceCurrency,
        alternativeToCandidateId,
        profileId,
      ],
    );
    return id;
  }

  it('creates all three tables', async () => {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'plants_inventory'
          AND table_name IN
            ('plant_candidate', 'candidate_conversion', 'candidate_suitability_assessment')`,
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'candidate_conversion',
      'candidate_suitability_assessment',
      'plant_candidate',
    ]);
  });

  it('grants the application role row access without schema authority, on all three tables', async () => {
    for (const table of [
      'plant_candidate',
      'candidate_conversion',
      'candidate_suitability_assessment',
    ]) {
      const result = await client.query<{ can_select: boolean; can_insert: boolean }>(
        `SELECT has_table_privilege('verdery_application', $1, 'SELECT') AS can_select,
                has_table_privilege('verdery_application', $1, 'INSERT') AS can_insert`,
        [`plants_inventory.${table}`],
      );
      expect(result.rows[0]).toEqual({ can_select: true, can_insert: true });
    }
  });

  it('accepts a well-formed active individual candidate with no quantity', async () => {
    await expect(
      insertCandidate({ groupingKind: 'individual', quantity: null }),
    ).resolves.not.toThrow();
  });

  it('rejects a non-positive quantity — the grouping-kind-vs-quantity linkage itself is an application-layer rule, mirroring plant.quantity', async () => {
    await expect(
      client.query(
        `INSERT INTO plants_inventory.plant_candidate
           (id, garden_id, display_name, grouping_kind, quantity, created_by_profile_id)
         VALUES ($1, $2, 'Bad', 'row', 0, $3)`,
        [randomUUID(), gardenId, profileId],
      ),
    ).rejects.toThrow(/plant_candidate_quantity_positive_check/);
  });

  it('rejects an unrecognized status', async () => {
    await expect(insertCandidate({ status: 'planted' })).rejects.toThrow(
      /plant_candidate_status_check/,
    );
  });

  it('rejects an unrecognized priority', async () => {
    await expect(insertCandidate({ priority: 'urgent' })).rejects.toThrow(
      /plant_candidate_priority_check/,
    );
  });

  it('rejects a price amount with no currency', async () => {
    await expect(insertCandidate({ priceAmount: 12.5, priceCurrency: null })).rejects.toThrow(
      /plant_candidate_price_pair_check/,
    );
  });

  it('rejects a currency with no price amount', async () => {
    await expect(insertCandidate({ priceAmount: null, priceCurrency: 'USD' })).rejects.toThrow(
      /plant_candidate_price_pair_check/,
    );
  });

  it('accepts a matched price amount and currency', async () => {
    await expect(
      insertCandidate({ priceAmount: 12.5, priceCurrency: 'USD' }),
    ).resolves.not.toThrow();
  });

  it('rejects a negative price amount', async () => {
    await expect(insertCandidate({ priceAmount: -1, priceCurrency: 'USD' })).rejects.toThrow(
      /plant_candidate_price_amount_check/,
    );
  });

  it('rejects a candidate naming itself as its own alternative', async () => {
    const id = randomUUID();
    await expect(insertCandidate({ id, alternativeToCandidateId: id })).rejects.toThrow(
      /plant_candidate_not_own_alternative_check/,
    );
  });

  it('allows a candidate to name a different candidate as its alternative', async () => {
    const first = await insertCandidate({});
    await expect(insertCandidate({ alternativeToCandidateId: first })).resolves.not.toThrow();
  });

  it('enforces at most one conversion per candidate', async () => {
    const candidateId = await insertCandidate({});
    const firstPlantId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.plant
         (id, garden_id, display_name, grouping_kind, created_by_profile_id)
       VALUES ($1, $2, 'Converted Tomato', 'individual', $3)`,
      [firstPlantId, gardenId, profileId],
    );
    await client.query(
      `INSERT INTO plants_inventory.candidate_conversion
         (id, candidate_id, plant_id, converted_by_profile_id)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), candidateId, firstPlantId, profileId],
    );

    const secondPlantId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.plant
         (id, garden_id, display_name, grouping_kind, created_by_profile_id)
       VALUES ($1, $2, 'Second Attempt', 'individual', $3)`,
      [secondPlantId, gardenId, profileId],
    );
    await expect(
      client.query(
        `INSERT INTO plants_inventory.candidate_conversion
           (id, candidate_id, plant_id, converted_by_profile_id)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), candidateId, secondPlantId, profileId],
      ),
    ).rejects.toThrow(/candidate_conversion_candidate_id_key/);
  });

  it('stores an append-only suitability assessment with a jsonb result', async () => {
    const candidateId = await insertCandidate({});
    await expect(
      client.query(
        `INSERT INTO plants_inventory.candidate_suitability_assessment (id, candidate_id, result)
         VALUES ($1, $2, $3::jsonb)`,
        [randomUUID(), candidateId, JSON.stringify({ matches: [], cautions: [], blockers: [] })],
      ),
    ).resolves.not.toThrow();
  });

  it('down reverses up: dropping and reapplying this migration leaves the schema intact', async () => {
    // `count: 7` undoes every newer migration (through
    // 1788200000000_plant-assertion-review-status-index.sql) first, then
    // this migration itself — the same "update this count when a later
    // migration is added on top" discipline every other rollback test in
    // this suite follows. The reapply below intentionally uses a SMALLER
    // count (5): it only needs to restore the three tables this test's own
    // assertion checks, all created by this migration alone — a stale,
    // smaller "up" count (found and fixed during P11-MEDIA-01 — this pair
    // had drifted out of sync since P11-DATA-02) leaves later migrations
    // un-reapplied without this test's own narrow table-name assertion ever
    // catching it, which is fine as long as the down count above stays
    // accurate.
    await migrate('down', 7);

    const afterDown = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'plants_inventory'
          AND table_name IN
            ('plant_candidate', 'candidate_conversion', 'candidate_suitability_assessment')`,
    );
    expect(afterDown.rows).toHaveLength(0);

    await migrate('up', 5);

    const afterReapply = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'plants_inventory'
          AND table_name IN
            ('plant_candidate', 'candidate_conversion', 'candidate_suitability_assessment')`,
    );
    expect(afterReapply.rows.map((row) => row.table_name).sort()).toEqual([
      'candidate_conversion',
      'candidate_suitability_assessment',
      'plant_candidate',
    ]);
  });
});
