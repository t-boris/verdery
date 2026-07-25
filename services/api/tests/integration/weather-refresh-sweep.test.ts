/**
 * Full-stack integration tests for P7-ASYNC-01's scheduled weather-refresh
 * sweep against real PostgreSQL/PostGIS: the real candidate source (the
 * cross-schema active+georeferenced selection with least-recently-fetched
 * ordering), the real `RefreshGardenWeather`, and real weather/quota rows —
 * only the provider is a deterministic fake (P0-PROV-01 undecided).
 *
 * The duplicate-safety half of the acceptance evidence for this sweep:
 * a repeated run inside the freshness window is a cache-hit no-op that
 * never touches the provider, and the no-provider reality is a typed,
 * repeatable, observable no-op — never a crash.
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { KyselyGeoreferenceRepository } from '../../src/modules/gardens-mapping/persistence/kysely-georeference-repository.js';
import {
  FakeWeatherProviderAdapter,
  SteppingClock,
  testProviderMetadata,
  testReading,
} from '../../src/modules/integrations/application/integrations-test-doubles.js';
import {
  RefreshGardenWeather,
  type RefreshGardenWeatherConfiguration,
} from '../../src/modules/integrations/application/refresh-garden-weather.js';
import { RunWeatherRefreshSweep } from '../../src/modules/integrations/application/run-weather-refresh-sweep.js';
import {
  WeatherProviderRegistry,
  type WeatherProviderRegistration,
} from '../../src/modules/integrations/application/weather-provider-registry.js';
import { KyselyProviderQuotaRepository } from '../../src/modules/integrations/persistence/kysely-provider-quota-repository.js';
import { KyselyWeatherRecordRepository } from '../../src/modules/integrations/persistence/kysely-weather-record-repository.js';
import { KyselyWeatherRefreshCandidateSource } from '../../src/modules/integrations/persistence/kysely-weather-refresh-candidate-source.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'weather refresh sweep integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const START = new Date('2026-07-25T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let profileId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
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

  async function insertGarden(lifecycleState: 'active' | 'archived'): Promise<string> {
    const gardenId = randomUUID();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'Sweep garden',
        lifecycle_state: lifecycleState,
        created_by_profile_id: profileId,
      })
      .execute();
    return gardenId;
  }

  async function georeference(gardenId: string): Promise<void> {
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
         ST_SetSRID(ST_MakePoint(4.3, 52.1), 4326),
         'userMeasurement', 'test-fixture', ${profileId})
    `.execute(db);
  }

  /** Removes every garden this suite created so each test's candidate set is exactly its own. */
  async function deleteAllGardens(): Promise<void> {
    await db.deleteFrom('integrations.weather_record').execute();
    await db.deleteFrom('gardens_mapping.georeference').execute();
    await db.deleteFrom('gardens_mapping.coordinate_space').execute();
    await db.deleteFrom('gardens_mapping.garden').execute();
  }

  function makeSweep(
    registrations: readonly WeatherProviderRegistration[],
    activeProviderKey: string | null,
    clock: SteppingClock,
  ): RunWeatherRefreshSweep {
    const configuration: RefreshGardenWeatherConfiguration = {
      activeProviderKey,
      freshnessPolicy: FRESHNESS,
    };
    const refresh = new RefreshGardenWeather(
      new WeatherProviderRegistry(registrations),
      configuration,
      new KyselyWeatherRecordRepository(db),
      new KyselyProviderQuotaRepository(db),
      new KyselyGeoreferenceRepository(db),
      clock,
    );
    return new RunWeatherRefreshSweep(new KyselyWeatherRefreshCandidateSource(db), refresh);
  }

  it('with zero providers configured, the sweep is a typed, repeatable, observable no-op over exactly the eligible gardens', async () => {
    await deleteAllGardens();
    const eligibleA = await insertGarden('active');
    await georeference(eligibleA);
    const eligibleB = await insertGarden('active');
    await georeference(eligibleB);
    const archived = await insertGarden('archived');
    await georeference(archived);
    await insertGarden('active'); // no georeference — physically unrefreshable

    const sweep = makeSweep([], null, new SteppingClock(START));
    const first = await sweep.execute();
    const second = await sweep.execute();

    const expected = {
      gardensConsidered: 2,
      refreshed: 0,
      freshCacheHits: 0,
      staleServed: 0,
      unavailable: 2,
      degradationReasons: { noProviderConfigured: 2 },
      stoppedOnQuotaExhaustion: false,
    };
    expect(first).toEqual(expected);
    // A duplicated/retried scheduled trigger repeats the identical no-op.
    expect(second).toEqual(expected);
    const records = await db.selectFrom('integrations.weather_record').selectAll().execute();
    expect(records).toEqual([]);
  });

  it('refreshes least-recently-fetched first, and a repeat run inside the freshness window is a cache hit that never calls the provider', async () => {
    await deleteAllGardens();
    const staleGarden = await insertGarden('active');
    await georeference(staleGarden);
    const freshGarden = await insertGarden('active');
    await georeference(freshGarden);

    const clock = new SteppingClock(START);
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 5 * 60 * 1000) })],
    });
    const registration = { metadata: testProviderMetadata('fake-provider-a'), adapter };
    const sweep = makeSweep([registration], 'fake-provider-a', clock);

    // Seed history: freshGarden was fetched two hours ago, staleGarden three —
    // both now stale, staleGarden more so, so it must be considered first.
    const records = new KyselyWeatherRecordRepository(db);
    const seed = (gardenId: string, fetchedAt: Date) => ({
      id: randomUUID(),
      gardenId,
      providerKey: 'fake-provider-a',
      kind: 'observation' as const,
      effectiveAt: fetchedAt,
      fetchedAt,
      location: { latitude: 52.1, longitude: 4.3 },
      measurements: {
        temperatureCelsius: 20,
        precipitationMm: null,
        windSpeedMps: null,
        humidityPercent: null,
      },
      sourceUnits: {
        temperature: 'celsius',
        precipitation: null,
        windSpeed: null,
        humidity: null,
      },
      quality: { confidence: null, label: null },
      licenseNote: 'seed license',
      attributionText: null,
      createdAt: fetchedAt,
    });
    await records.insertMany([seed(staleGarden, new Date(START.getTime() - 3 * HOUR_MS))]);
    await records.insertMany([seed(freshGarden, new Date(START.getTime() - 2 * HOUR_MS))]);

    const source = new KyselyWeatherRefreshCandidateSource(db);
    expect(await source.listRefreshCandidates(25)).toEqual([staleGarden, freshGarden]);

    const first = await sweep.execute();
    expect(first).toMatchObject({ gardensConsidered: 2, refreshed: 2 });
    expect(adapter.callCount).toBe(2);

    // Second run, five minutes later: both gardens are inside the freshness
    // window — served from storage, provider untouched. The cache window IS
    // the sweep-level idempotency boundary.
    clock.advanceMs(5 * 60 * 1000);
    const second = await sweep.execute();
    expect(second).toMatchObject({ gardensConsidered: 2, refreshed: 0, freshCacheHits: 2 });
    expect(adapter.callCount).toBe(2);
  });

  it('stops the batch on typed quota exhaustion instead of grinding through refusals', async () => {
    await deleteAllGardens();
    const gardenA = await insertGarden('active');
    await georeference(gardenA);
    const gardenB = await insertGarden('active');
    await georeference(gardenB);

    const clock = new SteppingClock(START);
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 5 * 60 * 1000) })],
    });
    const registration = {
      metadata: testProviderMetadata('fake-provider-b', {
        quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null },
      }),
      adapter,
    };

    const result = await makeSweep([registration], 'fake-provider-b', clock).execute();

    expect(adapter.callCount).toBe(1);
    expect(result).toMatchObject({
      gardensConsidered: 2,
      refreshed: 1,
      unavailable: 1,
      degradationReasons: { quotaExhausted: 1 },
      stoppedOnQuotaExhaustion: true,
    });
  });
});
