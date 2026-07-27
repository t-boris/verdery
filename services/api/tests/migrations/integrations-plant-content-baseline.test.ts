/**
 * Migration tests for the integrations plant-content baseline (P7-INT-02):
 * the `plant_taxonomy_mapping` table (every CHECK, the stable-taxonomy
 * foreign key, and the live-uniqueness partial index that makes
 * re-identification an explicit pair of rows), the append-only
 * `plant_content_record` table (every CHECK including the
 * at-least-one-section and license/presentation snapshot rules), the
 * privilege posture both tables inherit from the `integrations` schema's
 * default privileges, and the down migration's cleanup.
 *
 * Source: implementation-plan.md work package P7-INT-02;
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

const SUITE_NAME = 'integrations plant-content baseline migration';

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
  let taxonomyReferenceId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    taxonomyReferenceId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.taxonomy_reference (id, scientific_name, common_name, source)
       VALUES ($1, 'Solanum lycopersicum', 'Tomato', 'system_catalog')`,
      [taxonomyReferenceId],
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

  function mappingRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      taxonomy_reference_id: taxonomyReferenceId,
      provider_key: `fake-plant-provider-${randomUUID()}`,
      provider_taxon_id: 'taxon-1001',
      provider_scientific_name: 'Solanum lycopersicum',
      confidence: 0.92,
      ...overrides,
    };
  }

  const insertMapping = (overrides: Row = {}) =>
    insertRow('integrations.plant_taxonomy_mapping', mappingRow(overrides));

  function contentRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      provider_key: 'fake-plant-provider-a',
      provider_taxon_id: 'taxon-1001',
      provider_record_id: 'content-2001',
      provider_content_version: 'v1',
      content_language: 'en',
      description: 'A warm-season fruiting vegetable.',
      care_guidance: 'Water regularly; avoid wetting foliage.',
      fetched_at: new Date('2026-07-25T12:00:00Z'),
      license_note: 'test license: internal use only',
      attribution_text: 'Plant content by fake-plant-provider-a',
      jurisdiction: 'EU',
      presentation_note: 'verbatim with attribution',
      ...overrides,
    };
  }

  const insertContent = (overrides: Row = {}) =>
    insertRow('integrations.plant_content_record', contentRow(overrides));

  it('creates a mapping with the documented defaults: unverified, timestamped', async () => {
    const id = randomUUID();
    await insertMapping({ id });

    const row = await client.query<{
      verification_state: string;
      state_changed_at: Date;
      created_at: Date;
    }>(
      `SELECT verification_state, state_changed_at, created_at
         FROM integrations.plant_taxonomy_mapping WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.verification_state).toBe('unverified');
    expect(row.rows[0]?.state_changed_at).toBeInstanceOf(Date);
    expect(row.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it('enforces the mapping identity and metadata CHECKs', async () => {
    await expect(insertMapping({ provider_key: '' })).rejects.toThrow(
      /plant_taxonomy_mapping_provider_key_check/,
    );
    await expect(insertMapping({ provider_taxon_id: '' })).rejects.toThrow(
      /plant_taxonomy_mapping_provider_taxon_id_check/,
    );
    await expect(insertMapping({ provider_scientific_name: '' })).rejects.toThrow(
      /plant_taxonomy_mapping_scientific_name_check/,
    );
    await expect(insertMapping({ confidence: 1.5 })).rejects.toThrow(
      /plant_taxonomy_mapping_confidence_check/,
    );
    await expect(insertMapping({ verification_state: 'approved' })).rejects.toThrow(
      /plant_taxonomy_mapping_verification_state_check/,
    );
    await expect(insertMapping({ state_note: '' })).rejects.toThrow(
      /plant_taxonomy_mapping_state_note_check/,
    );
  });

  it('anchors mappings to the stable application taxonomy: a dangling reference is impossible', async () => {
    await expect(insertMapping({ taxonomy_reference_id: randomUUID() })).rejects.toThrow(
      /plant_taxonomy_mapping_taxonomy_reference_id_fkey/,
    );
  });

  it('allows at most one LIVE mapping per (provider, reference); rejection frees the slot for an explicit replacement', async () => {
    const providerKey = `fake-plant-provider-${randomUUID()}`;
    const firstId = randomUUID();
    await insertMapping({ id: firstId, provider_key: providerKey });

    // A second live claim for the same identity slot is physically rejected…
    await expect(
      insertMapping({ provider_key: providerKey, provider_taxon_id: 'taxon-other' }),
    ).rejects.toThrow(/plant_taxonomy_mapping_live_identity_idx/);
    // …and a DIFFERENT provider's claim on the same reference coexists.
    await insertMapping({ provider_key: `fake-plant-provider-${randomUUID()}` });

    // The explicit re-identification pair: reject the old row, insert the new.
    await client.query(
      `UPDATE integrations.plant_taxonomy_mapping
          SET verification_state = 'rejected', state_note = 'provider reorganized', state_changed_at = now()
        WHERE id = $1`,
      [firstId],
    );
    await insertMapping({ provider_key: providerKey, provider_taxon_id: 'taxon-other' });

    // The rejected row survives as history.
    const history = await client.query<{ verification_state: string; state_note: string }>(
      `SELECT verification_state, state_note
         FROM integrations.plant_taxonomy_mapping WHERE id = $1`,
      [firstId],
    );
    expect(history.rows[0]).toEqual({
      verification_state: 'rejected',
      state_note: 'provider reorganized',
    });
  });

  it('creates a content record with the documented defaults', async () => {
    const id = randomUUID();
    await insertContent({ id });

    const row = await client.query<{ created_at: Date }>(
      'SELECT created_at FROM integrations.plant_content_record WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it('enforces the content identity, section, and language CHECKs', async () => {
    await expect(insertContent({ provider_key: '' })).rejects.toThrow(
      /plant_content_record_provider_key_check/,
    );
    await expect(insertContent({ provider_taxon_id: '' })).rejects.toThrow(
      /plant_content_record_provider_taxon_id_check/,
    );
    await expect(insertContent({ provider_record_id: '' })).rejects.toThrow(
      /plant_content_record_provider_record_id_check/,
    );
    await expect(insertContent({ provider_content_version: '' })).rejects.toThrow(
      /plant_content_record_content_version_check/,
    );
    await expect(insertContent({ content_language: '' })).rejects.toThrow(
      /plant_content_record_content_language_check/,
    );
    await expect(insertContent({ description: '' })).rejects.toThrow(
      /plant_content_record_description_check/,
    );
    await expect(insertContent({ care_guidance: '' })).rejects.toThrow(
      /plant_content_record_care_guidance_check/,
    );
    // A row with neither section records nothing and is not a content record.
    await expect(insertContent({ description: null, care_guidance: null })).rejects.toThrow(
      /plant_content_record_section_present_check/,
    );
    // A single section with the other honestly absent is fine.
    await insertContent({ description: null });
  });

  it('enforces the license, attribution, jurisdiction, and presentation snapshot CHECKs', async () => {
    await expect(insertContent({ license_note: '' })).rejects.toThrow(
      /plant_content_record_license_note_check/,
    );
    await expect(insertContent({ attribution_text: '' })).rejects.toThrow(
      /plant_content_record_attribution_check/,
    );
    await expect(insertContent({ jurisdiction: '' })).rejects.toThrow(
      /plant_content_record_jurisdiction_check/,
    );
    await expect(insertContent({ presentation_note: '' })).rejects.toThrow(
      /plant_content_record_presentation_note_check/,
    );
  });

  it('grants verdery_application row access via the schema default privileges, and verdery_worker nothing', async () => {
    const result = await client.query<{
      app_mapping_select: boolean;
      app_mapping_update: boolean;
      app_content_insert: boolean;
      worker_mapping_select: boolean;
      worker_content_select: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_application', 'integrations.plant_taxonomy_mapping', 'SELECT') AS app_mapping_select,
         has_table_privilege('verdery_application', 'integrations.plant_taxonomy_mapping', 'UPDATE') AS app_mapping_update,
         has_table_privilege('verdery_application', 'integrations.plant_content_record', 'INSERT') AS app_content_insert,
         has_table_privilege('verdery_worker', 'integrations.plant_taxonomy_mapping', 'SELECT') AS worker_mapping_select,
         has_table_privilege('verdery_worker', 'integrations.plant_content_record', 'SELECT') AS worker_content_select`,
    );

    expect(result.rows[0]).toEqual({
      app_mapping_select: true,
      app_mapping_update: true,
      app_content_insert: true,
      // No worker touches plant content — see the migration's header comment.
      worker_mapping_select: false,
      worker_content_select: false,
    });
  });

  it('rolls back, dropping both plant-content tables while the weather tables and the schema survive', async () => {
    await client.end();

    // `count: 13` undoes the twelve newer migrations
    // (1786000000000_notifications-baseline.sql through
    // 1787100000000_taxonomy-seasonal-facts-and-bed-history.sql —
    // notification, AI-explanation, notification-delivery, service-
    // organization, client-publication, publisher-grant,
    // client-invitation-token, garden-context-facts, and
    // taxonomy-seasonal-facts-and-bed-history tables, nothing this file's
    // own assertions below check) first, then this migration itself.
    // Update again the next time a migration is added on top of that one.
    await migrate(databaseUrl, 'down', 14);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const dropped = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'integrations'
          AND table_name IN ('plant_taxonomy_mapping', 'plant_content_record')`,
    );
    expect(dropped.rows).toHaveLength(0);

    // The weather half of the module (previous migration) survives untouched.
    const surviving = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'integrations'
        ORDER BY table_name`,
    );
    expect(surviving.rows.map((row) => row.table_name)).toEqual([
      'provider_quota_usage',
      'weather_record',
    ]);

    // The taxonomy catalog row this suite anchored to survives.
    const reference = await client.query<{ scientific_name: string }>(
      'SELECT scientific_name FROM plants_inventory.taxonomy_reference WHERE id = $1',
      [taxonomyReferenceId],
    );
    expect(reference.rows[0]?.scientific_name).toBe('Solanum lycopersicum');
  });
});
