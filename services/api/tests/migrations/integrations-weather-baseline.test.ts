/**
 * Migration tests for the integrations weather baseline (P7-INT-01): the
 * new `integrations` schema and its privilege posture, every
 * `weather_record` CHECK (kind, unit-system pin, coordinate and measurement
 * ranges, source-units conversion-provenance consistency, license and
 * quality rules, the cannot-observe-the-future rule), the
 * `provider_quota_usage` counter table, the foreign key that closes
 * P7-DATA-01's documented `source_weather_record_id` deferral, and the down
 * migration's cleanup.
 *
 * Source: implementation-plan.md work package P7-INT-01;
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

const SUITE_NAME = 'integrations weather baseline migration';

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

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

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

  function weatherRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      garden_id: gardenId,
      provider_key: 'fake-provider-a',
      record_kind: 'observation',
      effective_at: new Date('2026-07-25T11:55:00Z'),
      fetched_at: new Date('2026-07-25T12:00:00Z'),
      latitude: 52.1,
      longitude: 4.3,
      temperature_celsius: 21.4,
      precipitation_mm: 0.2,
      wind_speed_mps: 3.1,
      humidity_percent: 64,
      source_units: JSON.stringify({
        temperature: 'celsius',
        precipitation: 'millimetre',
        windSpeed: 'metre_per_second',
        humidity: 'percent',
      }),
      license_note: 'test license: internal use only',
      ...overrides,
    };
  }

  const insertWeather = (overrides: Row = {}) =>
    insertRow('integrations.weather_record', weatherRow(overrides));

  it('creates a weather record with the documented defaults', async () => {
    const id = randomUUID();
    await insertWeather({ id });

    const row = await client.query<{ unit_system: string; created_at: Date }>(
      'SELECT unit_system, created_at FROM integrations.weather_record WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.unit_system).toBe('si');
    expect(row.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it('enforces provider key, record kind, and the unit-system pin', async () => {
    await expect(insertWeather({ provider_key: '' })).rejects.toThrow(
      /weather_record_provider_key_check/,
    );
    await expect(insertWeather({ record_kind: 'nowcast' })).rejects.toThrow(
      /weather_record_kind_check/,
    );
    await expect(insertWeather({ unit_system: 'imperial' })).rejects.toThrow(
      /weather_record_unit_system_check/,
    );
  });

  it('enforces coordinate, measurement, and confidence ranges', async () => {
    await expect(insertWeather({ latitude: 90.01 })).rejects.toThrow(
      /weather_record_latitude_check/,
    );
    await expect(insertWeather({ longitude: -180.01 })).rejects.toThrow(
      /weather_record_longitude_check/,
    );
    await expect(insertWeather({ precipitation_mm: -1 })).rejects.toThrow(
      /weather_record_precipitation_check/,
    );
    await expect(insertWeather({ wind_speed_mps: -0.1 })).rejects.toThrow(
      /weather_record_wind_speed_check/,
    );
    await expect(insertWeather({ humidity_percent: 101 })).rejects.toThrow(
      /weather_record_humidity_check/,
    );
    await expect(insertWeather({ provider_confidence: 1.5 })).rejects.toThrow(
      /weather_record_confidence_check/,
    );
  });

  it('requires at least one measurement and per-measurement conversion provenance', async () => {
    // No measurement at all: not a weather record.
    await expect(
      insertWeather({
        temperature_celsius: null,
        precipitation_mm: null,
        wind_speed_mps: null,
        humidity_percent: null,
        source_units: JSON.stringify({}),
      }),
    ).rejects.toThrow(/weather_record_measurement_present_check/);

    // A present measurement without its source unit…
    await expect(
      insertWeather({
        source_units: JSON.stringify({
          precipitation: 'millimetre',
          windSpeed: 'metre_per_second',
          humidity: 'percent',
        }),
      }),
    ).rejects.toThrow(/weather_record_source_units_consistency_check/);

    // …a recorded unit for a measurement that is not there…
    await expect(
      insertWeather({
        temperature_celsius: null,
        source_units: JSON.stringify({
          temperature: 'celsius',
          precipitation: 'millimetre',
          windSpeed: 'metre_per_second',
          humidity: 'percent',
        }),
      }),
    ).rejects.toThrow(/weather_record_source_units_consistency_check/);

    // …a blank unit label…
    await expect(
      insertWeather({
        source_units: JSON.stringify({
          temperature: '',
          precipitation: 'millimetre',
          windSpeed: 'metre_per_second',
          humidity: 'percent',
        }),
      }),
    ).rejects.toThrow(/weather_record_source_units_consistency_check/);

    // …and a non-object source_units value.
    await expect(insertWeather({ source_units: JSON.stringify(['celsius']) })).rejects.toThrow(
      /weather_record_source_units_consistency_check/,
    );

    // Partial measurements with matching provenance are fine.
    await insertWeather({
      precipitation_mm: null,
      wind_speed_mps: null,
      humidity_percent: null,
      source_units: JSON.stringify({ temperature: 'fahrenheit' }),
    });
  });

  it('rejects an observation claiming a future effective time, but accepts a future forecast', async () => {
    await expect(insertWeather({ effective_at: new Date('2026-07-25T15:00:00Z') })).rejects.toThrow(
      /weather_record_observation_not_future_check/,
    );
    await insertWeather({
      record_kind: 'forecast',
      effective_at: new Date('2026-07-26T12:00:00Z'),
    });
  });

  it('enforces license, attribution, and quality-label non-blankness', async () => {
    await expect(insertWeather({ license_note: '' })).rejects.toThrow(
      /weather_record_license_note_check/,
    );
    await expect(insertWeather({ attribution_text: '' })).rejects.toThrow(
      /weather_record_attribution_check/,
    );
    await expect(insertWeather({ provider_quality_label: '' })).rejects.toThrow(
      /weather_record_quality_label_check/,
    );
  });

  it('counts provider quota per window with one row per (provider, kind, start)', async () => {
    const windowStart = new Date('2026-07-25T12:00:00Z');
    await insertRow('integrations.provider_quota_usage', {
      provider_key: 'fake-provider-a',
      window_kind: 'hour',
      window_start: windowStart,
      call_count: 1,
    });
    await expect(
      insertRow('integrations.provider_quota_usage', {
        provider_key: 'fake-provider-a',
        window_kind: 'hour',
        window_start: windowStart,
        call_count: 1,
      }),
    ).rejects.toThrow(/provider_quota_usage_pkey/);
    await expect(
      insertRow('integrations.provider_quota_usage', {
        provider_key: 'fake-provider-a',
        window_kind: 'week',
        window_start: windowStart,
        call_count: 1,
      }),
    ).rejects.toThrow(/provider_quota_usage_window_kind_check/);
    await expect(
      insertRow('integrations.provider_quota_usage', {
        provider_key: '',
        window_kind: 'day',
        window_start: windowStart,
        call_count: 1,
      }),
    ).rejects.toThrow(/provider_quota_usage_provider_key_check/);
    await expect(
      insertRow('integrations.provider_quota_usage', {
        provider_key: 'fake-provider-a',
        window_kind: 'day',
        window_start: windowStart,
        call_count: -1,
      }),
    ).rejects.toThrow(/provider_quota_usage_call_count_check/);
  });

  it('closes the source_weather_record_id deferral: weather evidence must reference a real record', async () => {
    const ruleVersionId = randomUUID();
    await insertRow('tasks_recommendations.rule_version', {
      id: ruleVersionId,
      rule_key: `watering.summer.${randomUUID()}`,
      version: 1,
      safety_tier: 'ordinary_care',
    });
    const weatherRecordId = randomUUID();
    await insertWeather({ id: weatherRecordId });

    async function insertCandidateWithWeatherEvidence(
      sourceWeatherRecordId: string,
    ): Promise<void> {
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
          evidence_kind: 'weather',
          source_weather_record_id: sourceWeatherRecordId,
          fact_key: 'weather.rain',
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    // A dangling weather reference — accepted before this migration — is
    // now physically impossible.
    await expect(insertCandidateWithWeatherEvidence(randomUUID())).rejects.toThrow(
      /recommendation_evidence_source_weather_record_fkey/,
    );
    // A real one is accepted.
    await insertCandidateWithWeatherEvidence(weatherRecordId);
  });

  it('grants verdery_application row access via default privileges, and verdery_worker nothing', async () => {
    const result = await client.query<{
      app_weather_select: boolean;
      app_weather_insert: boolean;
      app_quota_insert: boolean;
      worker_weather_select: boolean;
      worker_quota_select: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_application', 'integrations.weather_record', 'SELECT') AS app_weather_select,
         has_table_privilege('verdery_application', 'integrations.weather_record', 'INSERT') AS app_weather_insert,
         has_table_privilege('verdery_application', 'integrations.provider_quota_usage', 'INSERT') AS app_quota_insert,
         has_table_privilege('verdery_worker', 'integrations.weather_record', 'SELECT') AS worker_weather_select,
         has_table_privilege('verdery_worker', 'integrations.provider_quota_usage', 'SELECT') AS worker_quota_select`,
    );

    expect(result.rows[0]).toEqual({
      app_weather_select: true,
      app_weather_insert: true,
      app_quota_insert: true,
      // No worker touches weather — P7-ASYNC-01's scheduled refresh calls
      // the API's own use case; see the migration's header comment.
      worker_weather_select: false,
      worker_quota_select: false,
    });
  });

  it('rolls back, dropping the integrations schema and the evidence FK while earlier tables survive', async () => {
    await client.end();

    // `count: 22` undoes every newer migration (through
    // 1787800000000_plant-search-extensions.sql, nothing this
    // file's own assertions below check) first, then this migration itself.
    // Update again the next time a migration is added on top of that one.
    await migrate(databaseUrl, 'down', 22);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const schemata = await client.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'integrations'`,
    );
    expect(schemata.rows).toHaveLength(0);

    const weatherFk = await client.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = 'tasks_recommendations' AND table_name = 'recommendation_evidence'
          AND constraint_name = 'recommendation_evidence_source_weather_record_fkey'`,
    );
    expect(weatherFk.rows).toHaveLength(0);

    // The recommendation tables (previous migration) and the garden row
    // survive untouched.
    const evidenceTable = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'tasks_recommendations' AND table_name = 'recommendation_evidence'`,
    );
    expect(evidenceTable.rows).toHaveLength(1);

    const garden = await client.query<{ name: string }>(
      'SELECT name FROM gardens_mapping.garden WHERE id = $1',
      [gardenId],
    );
    expect(garden.rows[0]?.name).toBe('Backyard');
  });
});
