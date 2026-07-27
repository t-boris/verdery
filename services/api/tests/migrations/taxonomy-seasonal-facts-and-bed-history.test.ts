/**
 * Migration tests for the P9D-SEASON-DATA-01 schema
 * (`migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql`):
 * `plants_inventory.taxonomy_seasonal_fact`'s CHECK constraints, run BOTH
 * directions against real Postgres — mirrors
 * `tests/migrations/garden-context-facts.test.ts` exactly, applied to this
 * table's two independent provenance axes (authoring method <-> source
 * citation, review status <-> reviewer sign-off) instead of one.
 *
 * Source: tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 1 —
 *         P9D-SEASON-DATA-01".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'taxonomy seasonal facts and bed history migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let taxonomyReferenceId: string;

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

  async function freshTaxonomyReference(): Promise<void> {
    taxonomyReferenceId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.taxonomy_reference (id, scientific_name, source)
       VALUES ($1, 'Solanum lycopersicum', 'system_catalog')`,
      [taxonomyReferenceId],
    );
  }

  async function insertFact(overrides: {
    hemisphere?: string;
    authoringMethod?: string;
    sourceCitation?: string | null;
    reviewStatus?: string;
    reviewedBy?: string | null;
    reviewedOn?: string | null;
  }): Promise<void> {
    const {
      hemisphere = 'northern',
      authoringMethod = 'human_authored',
      sourceCitation = null,
      reviewStatus = 'awaiting_horticultural_review',
      reviewedBy = null,
      reviewedOn = null,
    } = overrides;

    await client.query(
      `INSERT INTO plants_inventory.taxonomy_seasonal_fact
         (id, taxonomy_reference_id, hemisphere, authoring_method, source_citation,
          review_status, reviewed_by, reviewed_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        taxonomyReferenceId,
        hemisphere,
        authoringMethod,
        sourceCitation,
        reviewStatus,
        reviewedBy,
        reviewedOn,
      ],
    );
  }

  it('creates the table', async () => {
    const result = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'plants_inventory' AND table_name = 'taxonomy_seasonal_fact'`,
    );
    expect(result.rows.map((row) => row.qualified)).toEqual([
      'plants_inventory.taxonomy_seasonal_fact',
    ]);
  });

  it('adds family/genus to taxonomy_reference', async () => {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'plants_inventory' AND table_name = 'taxonomy_reference'
          AND column_name IN ('family', 'genus')`,
    );
    expect(result.rows.map((row) => row.column_name).sort()).toEqual(['family', 'genus']);
  });

  it('adds the placement/taxon snapshot columns to plant_revision', async () => {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'plants_inventory' AND table_name = 'plant_revision'
          AND column_name IN
            ('garden_area_map_object_id', 'placement_map_object_id', 'taxonomy_reference_id')`,
    );
    expect(result.rows.map((row) => row.column_name).sort()).toEqual([
      'garden_area_map_object_id',
      'placement_map_object_id',
      'taxonomy_reference_id',
    ]);
  });

  it('grants the application role row access without schema authority', async () => {
    const result = await client.query<{ can_select: boolean; can_insert: boolean }>(
      `SELECT has_table_privilege('verdery_application', 'plants_inventory.taxonomy_seasonal_fact', 'SELECT') AS can_select,
              has_table_privilege('verdery_application', 'plants_inventory.taxonomy_seasonal_fact', 'INSERT') AS can_insert`,
    );
    expect(result.rows[0]).toEqual({ can_select: true, can_insert: true });
  });

  it('accepts a well-formed human_authored, awaiting-review fact — the honest seed default', async () => {
    await freshTaxonomyReference();
    await expect(
      insertFact({
        authoringMethod: 'human_authored',
        reviewStatus: 'awaiting_horticultural_review',
      }),
    ).resolves.not.toThrow();
  });

  it('accepts a well-formed ai_extracted_from_source fact with sourceCitation and horticulturally_reviewed with reviewedBy/reviewedOn', async () => {
    await freshTaxonomyReference();
    await expect(
      insertFact({
        authoringMethod: 'ai_extracted_from_source',
        sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).resolves.not.toThrow();
  });

  it('rejects an unrecognized hemisphere', async () => {
    await freshTaxonomyReference();
    await expect(insertFact({ hemisphere: 'eastern' })).rejects.toThrow(
      /taxonomy_seasonal_fact_hemisphere_check/,
    );
  });

  it('rejects an out-of-range month', async () => {
    await freshTaxonomyReference();
    await expect(
      client.query(
        `INSERT INTO plants_inventory.taxonomy_seasonal_fact
           (id, taxonomy_reference_id, hemisphere, sow_indoors_start_month,
            authoring_method, review_status)
         VALUES ($1, $2, 'northern', 13, 'human_authored', 'awaiting_horticultural_review')`,
        [randomUUID(), taxonomyReferenceId],
      ),
    ).rejects.toThrow(/taxonomy_seasonal_fact_sow_indoors_start_month_check/);
  });

  it('rejects daysToMaturityMin greater than daysToMaturityMax', async () => {
    await freshTaxonomyReference();
    await expect(
      client.query(
        `INSERT INTO plants_inventory.taxonomy_seasonal_fact
           (id, taxonomy_reference_id, hemisphere, days_to_maturity_min, days_to_maturity_max,
            authoring_method, review_status)
         VALUES ($1, $2, 'northern', 90, 60, 'human_authored', 'awaiting_horticultural_review')`,
        [randomUUID(), taxonomyReferenceId],
      ),
    ).rejects.toThrow(/taxonomy_seasonal_fact_days_to_maturity_range_check/);
  });

  it('rejects an unrecognized authoringMethod', async () => {
    await freshTaxonomyReference();
    await expect(insertFact({ authoringMethod: 'guessed' })).rejects.toThrow(
      /taxonomy_seasonal_fact_authoring_method_check/,
    );
  });

  it('rejects ai_extracted_from_source missing sourceCitation — the missing-required-field direction', async () => {
    await freshTaxonomyReference();
    await expect(insertFact({ authoringMethod: 'ai_extracted_from_source' })).rejects.toThrow(
      /taxonomy_seasonal_fact_source_citation_linkage_check/,
    );
  });

  it('rejects human_authored carrying a sourceCitation — the disallowed-extra-field direction', async () => {
    await freshTaxonomyReference();
    await expect(
      insertFact({ authoringMethod: 'human_authored', sourceCitation: 'Some source' }),
    ).rejects.toThrow(/taxonomy_seasonal_fact_source_citation_linkage_check/);
  });

  it('rejects an unrecognized reviewStatus', async () => {
    await freshTaxonomyReference();
    await expect(insertFact({ reviewStatus: 'guessed' })).rejects.toThrow(
      /taxonomy_seasonal_fact_review_status_check/,
    );
  });

  it('rejects horticulturally_reviewed with reviewedBy/reviewedOn both NULL — the missing-required-fields direction', async () => {
    await freshTaxonomyReference();
    await expect(insertFact({ reviewStatus: 'horticulturally_reviewed' })).rejects.toThrow(
      /taxonomy_seasonal_fact_reviewed_linkage_check/,
    );
  });

  it('rejects awaiting_horticultural_review with reviewedBy/reviewedOn set — the disallowed-extra-fields direction', async () => {
    await freshTaxonomyReference();
    await expect(
      insertFact({
        reviewStatus: 'awaiting_horticultural_review',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).rejects.toThrow(/taxonomy_seasonal_fact_reviewed_linkage_check/);
  });

  it('rejects reviewedBy present without reviewedOn, independent of reviewStatus', async () => {
    await freshTaxonomyReference();
    await expect(
      insertFact({
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: null,
      }),
    ).rejects.toThrow(/taxonomy_seasonal_fact_(reviewed_linkage|reviewed_on_linkage)_check/);
  });

  it('rejects reviewedOn present without reviewedBy, independent of reviewStatus', async () => {
    await freshTaxonomyReference();
    await expect(
      insertFact({ reviewStatus: 'awaiting_horticultural_review', reviewedOn: '2026-03-15' }),
    ).rejects.toThrow(/taxonomy_seasonal_fact_reviewed_on_linkage_check/);
  });

  it('enforces UNIQUE (taxonomy_reference_id, hemisphere): a second fact for the same taxon and hemisphere is rejected', async () => {
    await freshTaxonomyReference();
    await insertFact({ hemisphere: 'northern' });

    await expect(insertFact({ hemisphere: 'northern' })).rejects.toThrow(
      /taxonomy_seasonal_fact_taxonomy_hemisphere_key/,
    );
  });

  it('allows the SAME taxon in the OTHER hemisphere', async () => {
    await freshTaxonomyReference();
    await insertFact({ hemisphere: 'northern' });

    await expect(insertFact({ hemisphere: 'southern' })).resolves.not.toThrow();
  });
});
