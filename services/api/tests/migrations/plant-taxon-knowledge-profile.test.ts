/**
 * Migration tests for P11-DATA-02
 * (`migrations/1787700000000_plant-taxon-knowledge-profile.sql`):
 * `plant_fact_assertion`, `plant_distribution_assertion`,
 * `plant_media_asset`, `taxonomy_name`, and `plant_profile_version` — table
 * shape, the reused authoring/review CHECK pairs, the ADR-0013 structural
 * toxicity/edibility exclusion, and that `down` genuinely reverses `up`.
 *
 * Source: implementation-plan.md work package P11-DATA-02;
 *         architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plant taxon knowledge profile migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let taxonomyReferenceId: string;

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
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function freshTaxonomyReference(): Promise<void> {
    taxonomyReferenceId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.taxonomy_reference (id, scientific_name, source)
       VALUES ($1, 'Ficus carica', 'system_catalog')`,
      [taxonomyReferenceId],
    );
  }

  async function insertFact(overrides: {
    providerKey?: string;
    factKey?: string;
    authoringMethod?: string;
    sourceCitation?: string | null;
    reviewStatus?: string;
    reviewedBy?: string | null;
    reviewedOn?: string | null;
  }): Promise<void> {
    const {
      providerKey = 'usda-plants',
      factKey = 'hardiness_zone_min',
      authoringMethod = 'ai_extracted_from_source',
      sourceCitation = 'USDA PLANTS, accessed 2026-07-29',
      reviewStatus = 'awaiting_horticultural_review',
      reviewedBy = null,
      reviewedOn = null,
    } = overrides;

    await client.query(
      `INSERT INTO integrations.plant_fact_assertion
         (id, provider_key, provider_taxon_id, fact_key, fact_value, authoring_method,
          source_citation, review_status, reviewed_by, reviewed_on)
       VALUES ($1, $2, 'PROV-123', $3, '5'::jsonb, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        providerKey,
        factKey,
        authoringMethod,
        sourceCitation,
        reviewStatus,
        reviewedBy,
        reviewedOn,
      ],
    );
  }

  it('creates all five tables', async () => {
    const result = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('integrations', 'plant_fact_assertion'),
          ('integrations', 'plant_distribution_assertion'),
          ('integrations', 'plant_media_asset'),
          ('plants_inventory', 'taxonomy_name'),
          ('plants_inventory', 'plant_profile_version')
        )`,
    );
    expect(result.rows.map((row) => row.qualified).sort()).toEqual([
      'integrations.plant_distribution_assertion',
      'integrations.plant_fact_assertion',
      'integrations.plant_media_asset',
      'plants_inventory.plant_profile_version',
      'plants_inventory.taxonomy_name',
    ]);
  });

  it('grants the application role row access without schema authority, on all five tables', async () => {
    for (const table of [
      'integrations.plant_fact_assertion',
      'integrations.plant_distribution_assertion',
      'integrations.plant_media_asset',
      'plants_inventory.taxonomy_name',
      'plants_inventory.plant_profile_version',
    ]) {
      const result = await client.query<{ can_select: boolean; can_insert: boolean }>(
        `SELECT has_table_privilege('verdery_application', $1, 'SELECT') AS can_select,
                has_table_privilege('verdery_application', $1, 'INSERT') AS can_insert`,
        [table],
      );
      expect(result.rows[0]).toEqual({ can_select: true, can_insert: true });
    }
  });

  describe('plant_fact_assertion', () => {
    it('accepts a well-formed ai_extracted_from_source fact awaiting review', async () => {
      await expect(insertFact({})).resolves.not.toThrow();
    });

    it('accepts a well-formed human_authored fact using the human sentinel identity', async () => {
      await expect(
        insertFact({
          providerKey: 'human',
          authoringMethod: 'human_authored',
          sourceCitation: null,
        }),
      ).resolves.not.toThrow();
    });

    it('rejects an unrecognized authoringMethod', async () => {
      await expect(insertFact({ authoringMethod: 'guessed' })).rejects.toThrow(
        /plant_fact_assertion_authoring_method_check/,
      );
    });

    it('rejects ai_extracted_from_source missing sourceCitation', async () => {
      await expect(
        insertFact({ authoringMethod: 'ai_extracted_from_source', sourceCitation: null }),
      ).rejects.toThrow(/plant_fact_assertion_source_citation_linkage_check/);
    });

    it('rejects horticulturally_reviewed with no reviewer', async () => {
      await expect(insertFact({ reviewStatus: 'horticulturally_reviewed' })).rejects.toThrow(
        /plant_fact_assertion_reviewed_linkage_check/,
      );
    });

    it("rejects toxicity authored by anything other than a human — ADR-0013's structural exclusion", async () => {
      await expect(
        insertFact({ factKey: 'toxicity', authoringMethod: 'ai_extracted_from_source' }),
      ).rejects.toThrow(/plant_fact_assertion_toxicity_edibility_human_only_check/);
    });

    it('rejects edibility proposed by a model, even into the review queue', async () => {
      await expect(
        insertFact({
          factKey: 'edibility',
          authoringMethod: 'ai_proposed_reviewed',
          sourceCitation: null,
        }),
      ).rejects.toThrow(/plant_fact_assertion_toxicity_edibility_human_only_check/);
    });

    it('accepts human-authored toxicity', async () => {
      await expect(
        insertFact({
          providerKey: 'human',
          factKey: 'toxicity',
          authoringMethod: 'human_authored',
          sourceCitation: null,
        }),
      ).resolves.not.toThrow();
    });

    it('rejects a non-human provider_key claiming human_authored', async () => {
      await expect(
        insertFact({
          providerKey: 'usda-plants',
          authoringMethod: 'human_authored',
          sourceCitation: null,
        }),
      ).rejects.toThrow(/plant_fact_assertion_human_authored_identity_check/);
    });
  });

  describe('plant_distribution_assertion', () => {
    it('accepts a well-formed native-status assertion', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_distribution_assertion
             (id, provider_key, provider_taxon_id, region, status, authoring_method,
              source_citation, review_status)
           VALUES ($1, 'usda-plants', 'PROV-123', 'US-CA', 'native', 'ai_extracted_from_source',
                   'USDA PLANTS', 'awaiting_horticultural_review')`,
          [randomUUID()],
        ),
      ).resolves.not.toThrow();
    });

    it('rejects an unrecognized status', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_distribution_assertion
             (id, provider_key, provider_taxon_id, region, status, authoring_method,
              source_citation, review_status)
           VALUES ($1, 'usda-plants', 'PROV-123', 'US-CA', 'endangered', 'ai_extracted_from_source',
                   'USDA PLANTS', 'awaiting_horticultural_review')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/plant_distribution_assertion_status_check/);
    });
  });

  describe('plant_media_asset', () => {
    it('accepts a discovered (not yet ingested) asset with only a source URL', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_media_asset
             (id, provider_key, provider_taxon_id, source_url, license)
           VALUES ($1, 'wikimedia', 'PROV-123', 'https://example.org/fig.jpg', 'cc_by')`,
          [randomUUID()],
        ),
      ).resolves.not.toThrow();
    });

    it('rejects an asset with neither media_id nor source_url', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_media_asset (id, provider_key, provider_taxon_id, license)
           VALUES ($1, 'wikimedia', 'PROV-123', 'cc_by')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/plant_media_asset_source_check/);
    });

    it('rejects ingestion_state = ingested with no media_id', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_media_asset
             (id, provider_key, provider_taxon_id, source_url, license, ingestion_state)
           VALUES ($1, 'wikimedia', 'PROV-123', 'https://example.org/fig.jpg', 'cc_by', 'ingested')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/plant_media_asset_ingestion_linkage_check/);
    });

    it('rejects an unrecognized organ', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_media_asset
             (id, provider_key, provider_taxon_id, source_url, license, organ)
           VALUES ($1, 'wikimedia', 'PROV-123', 'https://example.org/fig.jpg', 'cc_by', 'root')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/plant_media_asset_organ_check/);
    });

    it('rejects an unrecognized license', async () => {
      await expect(
        client.query(
          `INSERT INTO integrations.plant_media_asset
             (id, provider_key, provider_taxon_id, source_url, license)
           VALUES ($1, 'wikimedia', 'PROV-123', 'https://example.org/fig.jpg', 'all_rights_reserved')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/plant_media_asset_license_check/);
    });
  });

  describe('taxonomy_name', () => {
    it('accepts a locale-tagged common name', async () => {
      await freshTaxonomyReference();
      await expect(
        client.query(
          `INSERT INTO plants_inventory.taxonomy_name
             (id, taxonomy_reference_id, name_kind, locale, name_text, source)
           VALUES ($1, $2, 'common', 'en-US', 'Common fig', 'system_catalog')`,
          [randomUUID(), taxonomyReferenceId],
        ),
      ).resolves.not.toThrow();
    });

    it('accepts a locale-less scientific synonym', async () => {
      await freshTaxonomyReference();
      await expect(
        client.query(
          `INSERT INTO plants_inventory.taxonomy_name
             (id, taxonomy_reference_id, name_kind, name_text, source)
           VALUES ($1, $2, 'synonym_scientific', 'Ficus caprificus', 'system_catalog')`,
          [randomUUID(), taxonomyReferenceId],
        ),
      ).resolves.not.toThrow();
    });

    it('rejects a common name with no locale', async () => {
      await freshTaxonomyReference();
      await expect(
        client.query(
          `INSERT INTO plants_inventory.taxonomy_name
             (id, taxonomy_reference_id, name_kind, name_text, source)
           VALUES ($1, $2, 'common', 'Common fig', 'system_catalog')`,
          [randomUUID(), taxonomyReferenceId],
        ),
      ).rejects.toThrow(/taxonomy_name_locale_linkage_check/);
    });

    it('rejects provider_sourced with no provider_key', async () => {
      await freshTaxonomyReference();
      await expect(
        client.query(
          `INSERT INTO plants_inventory.taxonomy_name
             (id, taxonomy_reference_id, name_kind, locale, name_text, source)
           VALUES ($1, $2, 'common', 'en-US', 'Common fig', 'provider_sourced')`,
          [randomUUID(), taxonomyReferenceId],
        ),
      ).rejects.toThrow(/taxonomy_name_provider_key_linkage_check/);
    });
  });

  describe('plant_profile_version', () => {
    it('accepts a well-formed partial profile version', async () => {
      await freshTaxonomyReference();
      await expect(
        client.query(
          `INSERT INTO plants_inventory.plant_profile_version
             (id, taxonomy_reference_id, resolved, is_partial)
           VALUES ($1, $2, $3::jsonb, true)`,
          [
            randomUUID(),
            taxonomyReferenceId,
            JSON.stringify([{ factKey: 'hardinessZoneMin', value: 6 }]),
          ],
        ),
      ).resolves.not.toThrow();
    });

    it('rejects an empty resolved-facts array', async () => {
      await freshTaxonomyReference();
      await expect(
        client.query(
          `INSERT INTO plants_inventory.plant_profile_version (id, taxonomy_reference_id, resolved)
           VALUES ($1, $2, '[]'::jsonb)`,
          [randomUUID(), taxonomyReferenceId],
        ),
      ).rejects.toThrow(/plant_profile_version_resolved_not_empty_check/);
    });
  });

  it('down reverses up: dropping and reapplying this migration leaves the schema intact', async () => {
    // `count: 6` undoes 1788200000000_plant-assertion-review-status-index.sql,
    // 1788100000000_client-update-observation-kind.sql,
    // 1788000000000_health-suggestion-disposition.sql,
    // 1787900000000_visual-journal-observation-extensions.sql, and
    // 1787800000000_plant-search-extensions.sql (now the topmost migration),
    // then this migration itself. A stale, smaller count (found and fixed
    // during P11-MEDIA-01, and again during P11-PROV-01) leaves later
    // migrations un-reapplied without this test's own narrow table-name
    // assertion ever catching it. Update this count when a later migration
    // is added on top.
    await migrate('down', 6);

    const afterDown = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('integrations', 'plant_fact_assertion'),
          ('integrations', 'plant_distribution_assertion'),
          ('integrations', 'plant_media_asset'),
          ('plants_inventory', 'taxonomy_name'),
          ('plants_inventory', 'plant_profile_version')
        )`,
    );
    expect(afterDown.rows).toHaveLength(0);

    await migrate('up', 4);

    const afterReapply = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('integrations', 'plant_fact_assertion'),
          ('integrations', 'plant_distribution_assertion'),
          ('integrations', 'plant_media_asset'),
          ('plants_inventory', 'taxonomy_name'),
          ('plants_inventory', 'plant_profile_version')
        )`,
    );
    expect(afterReapply.rows).toHaveLength(5);
  });
});
