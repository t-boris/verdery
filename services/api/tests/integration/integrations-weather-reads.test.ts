/**
 * How stored weather is READ BACK, against real PostgreSQL — the sibling of
 * `integrations-weather.test.ts`, which covers the write side (refresh,
 * cache, quota, provider replacement).
 *
 * Split out from that suite when it crossed the 600-line rule, and the seam
 * is not arbitrary: every case here is about a query returning the right row
 * out of an APPEND-ONLY table that deliberately keeps contradictory and
 * repeated records. Both defects these tests pin were invisible to the write
 * side, because nothing was written wrongly — the rows were all correct, and
 * the reads over them were not.
 *
 * Source: architecture/external-integrations.md, section "5. Weather".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { KyselyWeatherRecordRepository } from '../../src/modules/integrations/persistence/kysely-weather-record-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'integrations weather reads integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let profileId: string;

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

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

    profileId = randomUUID();
    await db
      .insertInto('identity_access.profile')
      .values({ id: profileId, firebase_uid: `firebase-${profileId}`, account_state: 'active' })
      .execute();
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  /** A garden with a current georeference anchored at [longitude, latitude]. */
  async function insertGeoreferencedGarden(longitude: number, latitude: number): Promise<string> {
    const gardenId = randomUUID();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'Weather garden',
        lifecycle_state: 'active',
        created_by_profile_id: profileId,
      })
      .execute();
    const coordinateSpaceId = randomUUID();
    await db
      .insertInto('gardens_mapping.coordinate_space')
      .values({
        id: coordinateSpaceId,
        garden_id: gardenId,
        origin_description: 'south-west fence corner',
      })
      .execute();
    await sql`
      INSERT INTO gardens_mapping.georeference
        (id, garden_id, coordinate_space_id, local_anchor, geographic_anchor,
         provenance, method, created_by_profile_id)
      VALUES
        (${randomUUID()}, ${gardenId}, ${coordinateSpaceId},
         ST_SetSRID(ST_MakePoint(0, 0), 0),
         ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
         'userMeasurement', 'test-fixture', ${profileId})
    `.execute(db);
    return gardenId;
  }

  it('reads the point observation by effective time, not by the id that happened to be largest in its batch', async () => {
    // The real insert order: the point reading is built first and the daily
    // totals after, so within one batch the point reading holds the SMALLEST
    // UUIDv7 and the last daily total the largest. `fetched_at` and
    // `created_at` are identical across the batch, so `findLatest`'s id
    // tie-break handed back a rain-only row and blanked everything else.
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const records = new KyselyWeatherRecordRepository(db);
    const base = {
      gardenId,
      providerKey: 'fake-provider-a',
      kind: 'observation' as const,
      location: { latitude: 52.1, longitude: 4.3 },
      quality: { confidence: null, label: null },
      licenseNote: 'seed license',
      attributionText: null,
    };
    const fetchedAt = new Date('2026-07-25T12:00:00Z');
    // Ascending ids, matching how the batch is actually generated.
    const pointId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f0001';
    const dailyIds = [
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f0002',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f0003',
    ];

    await records.insertMany([
      {
        ...base,
        id: pointId,
        effectiveAt: new Date('2026-07-25T11:55:00Z'),
        fetchedAt,
        createdAt: fetchedAt,
        precipitationIntervalSeconds: 3600,
        measurements: {
          temperatureCelsius: 19.4,
          precipitationMm: 0,
          windSpeedMps: 2.1,
          humidityPercent: 61,
        },
        // A unit label exists exactly where a measurement does — the
        // migration's own `weather_record_source_units_consistency_check`.
        sourceUnits: {
          temperature: 'celsius',
          precipitation: 'millimetre',
          windSpeed: 'metre_per_second',
          humidity: 'percent',
        },
      },
      ...dailyIds.map((id, index) => ({
        ...base,
        id,
        effectiveAt: new Date(`2026-07-2${String(3 + index)}T00:00:00Z`),
        fetchedAt,
        createdAt: fetchedAt,
        precipitationIntervalSeconds: 86_400,
        measurements: {
          temperatureCelsius: null,
          precipitationMm: 4.5,
          windSpeedMps: null,
          humidityPercent: null,
        },
        // Rain only — which is the whole point of the case.
        sourceUnits: {
          temperature: null,
          precipitation: 'millimetre',
          windSpeed: null,
          humidity: null,
        },
      })),
    ]);

    const observation = await records.findLatestObservation(gardenId);
    expect(observation?.id).toBe(pointId);
    expect(observation?.measurements.temperatureCelsius).toBe(19.4);
    expect(observation?.measurements.humidityPercent).toBe(61);
    expect(observation?.measurements.windSpeedMps).toBe(2.1);

    // `findLatest` keeps its retrieval-order meaning untouched: it serves the
    // cache decision in `RefreshGardenWeather`, which asks what this system
    // most recently LEARNED, not what moment the reading is about.
    const mostRecentlyFetched = await records.findLatest(gardenId, 'observation');
    expect(mostRecentlyFetched?.id).toBe(dailyIds[1]);
  });

  it('serves the nearest upcoming forecast, and an overtaken one rather than nothing', async () => {
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const records = new KyselyWeatherRecordRepository(db);
    const now = new Date('2026-07-25T12:00:00Z');
    const base = {
      gardenId,
      providerKey: 'fake-provider-a',
      kind: 'forecast' as const,
      location: { latitude: 52.1, longitude: 4.3 },
      quality: { confidence: null, label: null },
      licenseNote: 'seed license',
      attributionText: null,
      fetchedAt: now,
      createdAt: now,
      precipitationIntervalSeconds: 86_400,
      measurements: {
        temperatureCelsius: null,
        precipitationMm: 1.5,
        windSpeedMps: null,
        humidityPercent: null,
      },
      sourceUnits: {
        temperature: null,
        precipitation: 'millimetre',
        windSpeed: null,
        humidity: null,
      },
    };

    const nearId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f1001';
    const farId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f1009';
    await records.insertMany([
      { ...base, id: nearId, effectiveAt: new Date('2026-07-26T00:00:00Z') },
      // The larger id, and the furthest day — what retrieval order used to
      // hand back, and what the deployed panel showed as "the" forecast.
      { ...base, id: farId, effectiveAt: new Date('2026-07-31T00:00:00Z') },
    ]);

    const next = await records.findNextForecast(gardenId, now);
    expect(next?.id).toBe(nearId);

    // Once every stored forecast has been overtaken, the most recent one is
    // still served so the caller can label it stale — an absence and an
    // out-of-date reading are different answers.
    const afterAll = await records.findNextForecast(gardenId, new Date('2026-08-05T00:00:00Z'));
    expect(afterAll?.id).toBe(farId);
  });

  it('counts each elapsed period once no matter how many sweeps stored it, keeping the newest reading and the whole history', async () => {
    // The provider is asked for `past_days` of daily totals on EVERY refresh,
    // so an append-only table accumulates one row per elapsed day per sweep.
    // Summing the raw rows multiplied a garden's rainfall by the number of
    // sweeps behind it (observed on dev: 175.2 mm "across 18 of 7 days"
    // against a true 58.4 mm), which makes `watering.dry-spell-check`
    // under-fire — it stays silent on a garden that is actually short of
    // water, and silence looks the same whether it is right or wrong.
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const records = new KyselyWeatherRecordRepository(db);
    const base = {
      gardenId,
      providerKey: 'fake-provider-a',
      kind: 'observation' as const,
      location: { latitude: 52.1, longitude: 4.3 },
      sourceUnits: {
        temperature: null,
        precipitation: 'millimetre',
        windSpeed: null,
        humidity: null,
      },
      quality: { confidence: null, label: null },
      licenseNote: 'seed license',
      attributionText: null,
    };
    const rainfall = (precipitationMm: number) => ({
      temperatureCelsius: null,
      precipitationMm,
      windSpeedMps: null,
      humidityPercent: null,
    });
    const DAY_MS = 24 * HOUR_MS;
    const dayOne = new Date('2026-07-20T00:00:00Z');
    const dayTwo = new Date('2026-07-21T00:00:00Z');
    const dailyRow = (effectiveAt: Date, fetchedAt: Date, precipitationMm: number) => ({
      ...base,
      id: randomUUID(),
      effectiveAt,
      fetchedAt,
      createdAt: fetchedAt,
      precipitationIntervalSeconds: DAY_MS / 1000,
      measurements: rainfall(precipitationMm),
    });

    const firstSweep = new Date('2026-07-22T06:00:00Z');
    const secondSweep = new Date('2026-07-22T07:00:00Z');
    const thirdSweep = new Date('2026-07-22T08:00:00Z');
    await records.insertMany([
      // Three sweeps, each storing BOTH elapsed days again. The last sweep
      // also revises day one downward, the way a model re-analysis does.
      dailyRow(dayOne, firstSweep, 9),
      dailyRow(dayTwo, firstSweep, 2),
      dailyRow(dayOne, secondSweep, 9),
      dailyRow(dayTwo, secondSweep, 2),
      dailyRow(dayOne, thirdSweep, 4),
      dailyRow(dayTwo, thirdSweep, 2),
      // An hourly total inside day two, so the collapse is proved to be per
      // PERIOD and not a truncation to the calendar day — collapsing hourly
      // rows per day would discard twenty-three hours of rain.
      {
        ...base,
        id: randomUUID(),
        effectiveAt: new Date(dayTwo.getTime() + HOUR_MS),
        fetchedAt: firstSweep,
        createdAt: firstSweep,
        precipitationIntervalSeconds: HOUR_MS / 1000,
        measurements: rainfall(0.5),
      },
      {
        ...base,
        id: randomUUID(),
        effectiveAt: new Date(dayTwo.getTime() + 2 * HOUR_MS),
        fetchedAt: firstSweep,
        createdAt: firstSweep,
        precipitationIntervalSeconds: HOUR_MS / 1000,
        measurements: rainfall(0.25),
      },
    ]);

    const daily = await records.listElapsedPrecipitation(gardenId, DAY_MS / 1000, dayOne);
    expect(daily).toEqual([
      // Day one carries the revised figure from the newest sweep, not 9 and
      // not 22; day two carries its single agreed total once.
      { effectiveAt: dayOne, precipitationMm: 4 },
      { effectiveAt: dayTwo, precipitationMm: 2 },
    ]);

    const hourly = await records.listElapsedPrecipitation(gardenId, HOUR_MS / 1000, dayOne);
    expect(hourly).toHaveLength(2);

    // Nothing was repaired away: the collapse is a property of this READ, and
    // every fetch fact survives as append-only history.
    const stored = await db
      .selectFrom('integrations.weather_record')
      .select(db.fn.countAll<number>().as('rows'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(stored.rows)).toBe(8);
  });
});
