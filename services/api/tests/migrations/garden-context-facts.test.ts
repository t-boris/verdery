/**
 * Migration tests for garden context facts (P9D-CONTEXT-01):
 * `gardens_mapping.garden_context_fact`. Proves the CHECK constraints
 * genuinely run BOTH directions — a `horticulturally_reviewed_default` row
 * missing `reviewed_by`/`reviewed_on`, and a `user_declared`/`imported` row
 * carrying them — not merely that the migration applied.
 *
 * Source: implementation-plan.md §18.2, work package P9D-CONTEXT-01
 * ("Context provenance tests");
 * migrations/1787000000000_garden-context-facts.sql.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'garden context facts migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let profileId: string;
  let gardenId: string;

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

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function freshGarden(): Promise<void> {
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
  }

  async function insertFact(overrides: {
    contextKind?: string;
    value?: string;
    source?: string;
    reviewedBy?: string | null;
    reviewedOn?: string | null;
  }): Promise<void> {
    const {
      contextKind = 'sun_exposure',
      value = 'full_sun',
      source = 'user_declared',
      reviewedBy = null,
      reviewedOn = null,
    } = overrides;

    await client.query(
      `INSERT INTO gardens_mapping.garden_context_fact
         (id, garden_id, context_kind, value, source, reviewed_by, reviewed_on, recorded_by_profile_id, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [randomUUID(), gardenId, contextKind, value, source, reviewedBy, reviewedOn, profileId],
    );
  }

  it('creates the table', async () => {
    const result = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'gardens_mapping' AND table_name = 'garden_context_fact'`,
    );
    expect(result.rows.map((row) => row.qualified)).toEqual([
      'gardens_mapping.garden_context_fact',
    ]);
  });

  it('grants the application role row access without schema authority', async () => {
    const result = await client.query<{ can_select: boolean; can_insert: boolean }>(
      `SELECT has_table_privilege('verdery_application', 'gardens_mapping.garden_context_fact', 'SELECT') AS can_select,
              has_table_privilege('verdery_application', 'gardens_mapping.garden_context_fact', 'INSERT') AS can_insert`,
    );
    expect(result.rows[0]).toEqual({ can_select: true, can_insert: true });
  });

  it('accepts a well-formed user_declared fact', async () => {
    await freshGarden();
    await expect(insertFact({ source: 'user_declared' })).resolves.not.toThrow();
  });

  it('accepts a well-formed horticulturally_reviewed_default fact with reviewedBy/reviewedOn', async () => {
    await freshGarden();
    await expect(
      insertFact({
        source: 'horticulturally_reviewed_default',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).resolves.not.toThrow();
  });

  it('rejects an unrecognized contextKind', async () => {
    await freshGarden();
    await expect(insertFact({ contextKind: 'wind_speed' })).rejects.toThrow(
      /garden_context_fact_context_kind_check/,
    );
  });

  it('rejects a blank value', async () => {
    await freshGarden();
    await expect(insertFact({ value: '   ' })).rejects.toThrow(
      /garden_context_fact_value_not_blank_check/,
    );
  });

  it('rejects an unrecognized source', async () => {
    await freshGarden();
    await expect(insertFact({ source: 'guessed' })).rejects.toThrow(
      /garden_context_fact_source_check/,
    );
  });

  it('rejects horticulturally_reviewed_default with reviewedBy/reviewedOn both NULL — the missing-required-fields direction', async () => {
    await freshGarden();
    await expect(insertFact({ source: 'horticulturally_reviewed_default' })).rejects.toThrow(
      /garden_context_fact_source_reviewed_linkage_check/,
    );
  });

  it('rejects a user_declared fact that HAS reviewedBy/reviewedOn set — the disallowed-extra-fields direction', async () => {
    await freshGarden();
    await expect(
      insertFact({
        source: 'user_declared',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).rejects.toThrow(/garden_context_fact_source_reviewed_linkage_check/);
  });

  it('rejects an imported fact that HAS reviewedBy/reviewedOn set — same disallowed-extra-fields direction, different source', async () => {
    await freshGarden();
    await expect(
      insertFact({ source: 'imported', reviewedBy: 'Dr. Amara Osei', reviewedOn: '2026-03-15' }),
    ).rejects.toThrow(/garden_context_fact_source_reviewed_linkage_check/);
  });

  it('rejects reviewedBy present without reviewedOn, independent of source', async () => {
    await freshGarden();
    await expect(
      insertFact({
        source: 'horticulturally_reviewed_default',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: null,
      }),
    ).rejects.toThrow(/garden_context_fact_(source_reviewed|reviewed_on)_linkage_check/);
  });

  it('rejects reviewedOn present without reviewedBy, independent of source', async () => {
    await freshGarden();
    await expect(
      insertFact({ source: 'user_declared', reviewedBy: null, reviewedOn: '2026-03-15' }),
    ).rejects.toThrow(/garden_context_fact_reviewed_on_linkage_check/);
  });

  it('enforces UNIQUE (garden_id, context_kind): a second fact of the same kind for the same garden is rejected', async () => {
    await freshGarden();
    await insertFact({ contextKind: 'drainage', value: 'well_drained' });

    await expect(insertFact({ contextKind: 'drainage', value: 'poor_drainage' })).rejects.toThrow(
      /garden_context_fact_garden_context_kind_key/,
    );
  });

  it('allows the same contextKind on a DIFFERENT garden', async () => {
    await freshGarden();
    await insertFact({ contextKind: 'drainage', value: 'well_drained' });

    const otherGardenId = randomUUID();
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Other Garden', $2)`,
      [otherGardenId, profileId],
    );
    await expect(
      client.query(
        `INSERT INTO gardens_mapping.garden_context_fact
           (id, garden_id, context_kind, value, source, recorded_by_profile_id, recorded_at)
         VALUES ($1, $2, 'drainage', 'poor_drainage', 'user_declared', $3, now())`,
        [randomUUID(), otherGardenId, profileId],
      ),
    ).resolves.not.toThrow();
  });
});
