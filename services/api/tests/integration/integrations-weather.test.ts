/**
 * Full-stack integration tests for the integrations module against real
 * PostgreSQL/PostGIS: the real Kysely weather-record and provider-quota
 * repositories, the real gardens-mapping georeference repository, and the
 * real use cases — only the weather PROVIDER is a deterministic fake,
 * because no real vendor exists (P0-PROV-01 undecided; see
 * `application/weather-provider.ts`).
 *
 * Covers P7-INT-01's acceptance evidence end to end: normalized persistence
 * with license/provenance round-trip, cache-not-refetch within the
 * freshness window, stale classification past it, the typed no-provider
 * state, atomic quota accounting (including the hour/day rollback
 * interplay), and provider replacement through one registration plus a
 * configuration key change.
 *
 * Source: implementation-plan.md work package P7-INT-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
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
import { GetGardenWeather } from '../../src/modules/integrations/application/get-garden-weather.js';
import {
  RefreshGardenWeather,
  type RefreshGardenWeatherConfiguration,
} from '../../src/modules/integrations/application/refresh-garden-weather.js';
import {
  WeatherProviderRegistry,
  type WeatherProviderRegistration,
} from '../../src/modules/integrations/application/weather-provider-registry.js';
import { KyselyProviderQuotaRepository } from '../../src/modules/integrations/persistence/kysely-provider-quota-repository.js';
import { KyselyWeatherRecordRepository } from '../../src/modules/integrations/persistence/kysely-weather-record-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'integrations weather integration';
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

  function makeRefresh(
    registrations: readonly WeatherProviderRegistration[],
    activeProviderKey: string | null,
    clock: SteppingClock,
    freshnessPolicy = FRESHNESS,
  ): RefreshGardenWeather {
    const configuration: RefreshGardenWeatherConfiguration = {
      activeProviderKey,
      freshnessPolicy,
    };
    return new RefreshGardenWeather(
      new WeatherProviderRegistry(registrations),
      configuration,
      new KyselyWeatherRecordRepository(db),
      new KyselyProviderQuotaRepository(db),
      new KyselyGeoreferenceRepository(db),
      clock,
    );
  }

  it('persists normalized records and reads them back whole: measurements, provenance, quality, license, location', async () => {
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const clock = new SteppingClock(START);
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [
        testReading({
          effectiveAt: new Date(START.getTime() - 5 * 60 * 1000),
          measurements: {
            temperatureCelsius: 19.5,
            precipitationMm: null,
            windSpeedMps: 2.4,
            humidityPercent: null,
          },
          sourceUnits: {
            temperature: 'fahrenheit',
            precipitation: null,
            windSpeed: 'mile_per_hour',
            humidity: null,
          },
          quality: { confidence: 0.75, label: 'estimated' },
        }),
      ],
    });
    const metadata = testProviderMetadata('fake-provider-a');
    const refresh = makeRefresh([{ metadata, adapter }], 'fake-provider-a', clock);

    const result = await refresh.execute({ gardenId });
    expect(result.outcome).toBe('refreshed');

    const readBack = await new KyselyWeatherRecordRepository(db).findLatest(
      gardenId,
      'observation',
    );
    expect(readBack).not.toBeNull();
    expect(readBack?.providerKey).toBe('fake-provider-a');
    expect(readBack?.measurements).toEqual({
      temperatureCelsius: 19.5,
      precipitationMm: null,
      windSpeedMps: 2.4,
      humidityPercent: null,
    });
    expect(readBack?.sourceUnits).toEqual({
      temperature: 'fahrenheit',
      precipitation: null,
      windSpeed: 'mile_per_hour',
      humidity: null,
    });
    expect(readBack?.quality).toEqual({ confidence: 0.75, label: 'estimated' });
    expect(readBack?.licenseNote).toBe(metadata.licenseNote);
    expect(readBack?.attributionText).toBe(metadata.attributionText);
    expect(readBack?.location).toEqual({ latitude: 52.1, longitude: 4.3 });
    expect(readBack?.fetchedAt).toEqual(START);
  });

  it('serves a repeat request within the freshness window from storage, never refetching; refetches and classifies stale past it', async () => {
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const clock = new SteppingClock(START);
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 60_000) })],
    });
    const refresh = makeRefresh(
      [{ metadata: testProviderMetadata('fake-provider-a'), adapter }],
      'fake-provider-a',
      clock,
    );
    const query = new GetGardenWeather(new KyselyWeatherRecordRepository(db), FRESHNESS, clock);

    await refresh.execute({ gardenId });
    clock.advanceMs(FRESHNESS.observationFreshForMs);
    const cached = await refresh.execute({ gardenId });
    expect(cached.outcome).toBe('freshCacheHit');
    expect(adapter.callCount).toBe(1);
    await expect(query.execute({ gardenId })).resolves.toMatchObject({
      outcome: 'available',
      freshness: 'fresh',
    });

    clock.advanceMs(1);
    await expect(query.execute({ gardenId })).resolves.toMatchObject({
      outcome: 'available',
      freshness: 'stale',
    });
    const refetched = await refresh.execute({ gardenId });
    expect(refetched.outcome).toBe('refreshed');
    expect(adapter.callCount).toBe(2);
  });

  it('resolves CONTRADICTORY stored records deterministically: the latest fetch wins, created_at breaks a fetch-time tie, history stays whole', async () => {
    // P7-QA-01 contradictory-fact case: append-only fetch facts can disagree
    // (a re-fetch after a provider correction, or two providers' readings for
    // the same moment). The rule engine consumes exactly ONE record —
    // whatever `findLatest` returns — so the resolution order
    // (fetched_at DESC, created_at DESC, id DESC) is load-bearing: without a
    // pinned deterministic winner, evaluation would flap between
    // contradictory readings run to run.
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const records = new KyselyWeatherRecordRepository(db);
    const base = {
      gardenId,
      providerKey: 'fake-provider-a',
      kind: 'observation' as const,
      location: { latitude: 52.1, longitude: 4.3 },
      sourceUnits: {
        temperature: 'celsius',
        precipitation: 'millimetre',
        windSpeed: null,
        humidity: null,
      },
      quality: { confidence: null, label: null },
      licenseNote: 'seed license',
      attributionText: null,
    };
    const measurements = (temperatureCelsius: number, precipitationMm: number) => ({
      temperatureCelsius,
      precipitationMm,
      windSpeedMps: null,
      humidityPercent: null,
    });
    const olderFetchAt = new Date(START.getTime() - 2 * HOUR_MS);
    const newerFetchAt = new Date(START.getTime() - HOUR_MS);
    await records.insertMany([
      // The older fetch claims a warm dry day...
      {
        ...base,
        id: randomUUID(),
        effectiveAt: olderFetchAt,
        fetchedAt: olderFetchAt,
        createdAt: olderFetchAt,
        measurements: measurements(27, 0),
      },
      // ...the newer fetch contradicts it outright for the same garden...
      {
        ...base,
        id: randomUUID(),
        effectiveAt: newerFetchAt,
        fetchedAt: newerFetchAt,
        createdAt: newerFetchAt,
        measurements: measurements(8, 12),
      },
      // ...and a third row shares the newer fetch instant but was written
      // earlier — the created_at tie-break must lose to the row above.
      {
        ...base,
        id: randomUUID(),
        effectiveAt: newerFetchAt,
        fetchedAt: newerFetchAt,
        createdAt: new Date(newerFetchAt.getTime() - 60_000),
        measurements: measurements(31, 0),
      },
    ]);

    const latest = await records.findLatest(gardenId, 'observation');
    expect(latest?.measurements).toEqual(measurements(8, 12));

    // The contradiction is never repaired away: every fetch fact survives as
    // append-only history.
    const stored = await db
      .selectFrom('integrations.weather_record')
      .select(db.fn.countAll<number>().as('rows'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(stored.rows)).toBe(3);
  });

  it('returns the typed no-provider outcome with zero providers configured and persists nothing', async () => {
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const refresh = makeRefresh([], null, new SteppingClock(START));

    const result = await refresh.execute({ gardenId });
    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });

    await expect(
      new GetGardenWeather(
        new KyselyWeatherRecordRepository(db),
        FRESHNESS,
        new SteppingClock(START),
      ).execute({ gardenId }),
    ).resolves.toEqual({ outcome: 'noRecord' });
  });

  it('enforces the hourly budget across gardens through the real counter table', async () => {
    const gardenA = await insertGeoreferencedGarden(4.3, 52.1);
    const gardenB = await insertGeoreferencedGarden(13.4, 52.5);
    const clock = new SteppingClock(START);
    const adapter = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 60_000) })],
    });
    const providerKey = `fake-provider-${randomUUID()}`;
    const metadata = testProviderMetadata(providerKey, {
      quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null },
    });
    const refresh = makeRefresh([{ metadata, adapter }], providerKey, clock);

    await expect(refresh.execute({ gardenId: gardenA })).resolves.toMatchObject({
      outcome: 'refreshed',
    });
    // Garden B has no stored record: the exhausted budget is a typed
    // unavailable, not a silently skipped call.
    await expect(refresh.execute({ gardenId: gardenB })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'quotaExhausted',
    });
    expect(adapter.callCount).toBe(1);

    const usage = await db
      .selectFrom('integrations.provider_quota_usage')
      .select(['window_kind', 'call_count'])
      .where('provider_key', '=', providerKey)
      .orderBy('window_kind')
      .execute();
    expect(usage).toEqual([
      { window_kind: 'day', call_count: 1 },
      { window_kind: 'hour', call_count: 1 },
    ]);
  });

  it('rolls the hour increment back when the day budget refuses, atomically', async () => {
    const providerKey = `fake-provider-${randomUUID()}`;
    const quotas = new KyselyProviderQuotaRepository(db);
    const limits = { maxCallsPerHour: null, maxCallsPerDay: 1 };

    await expect(quotas.consumeCall(providerKey, limits, START)).resolves.toEqual({
      consumed: true,
    });
    await expect(quotas.consumeCall(providerKey, limits, START)).resolves.toEqual({
      consumed: false,
      exhaustedWindow: 'day',
    });

    const usage = await db
      .selectFrom('integrations.provider_quota_usage')
      .select(['window_kind', 'call_count'])
      .where('provider_key', '=', providerKey)
      .orderBy('window_kind')
      .execute();
    // The refused call left NO trace in either window — the hour increment
    // its transaction had already made was rolled back with the refusal.
    expect(usage).toEqual([
      { window_kind: 'day', call_count: 1 },
      { window_kind: 'hour', call_count: 1 },
    ]);
  });

  it('replaces the provider with one registration plus a configuration change, leaving prior records untouched', async () => {
    const gardenId = await insertGeoreferencedGarden(4.3, 52.1);
    const clock = new SteppingClock(START);
    const adapterA = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 60_000) })],
    });
    const adapterB = new FakeWeatherProviderAdapter({
      kind: 'succeed',
      readings: [testReading({ effectiveAt: new Date(START.getTime() - 30_000) })],
    });
    const registrations: WeatherProviderRegistration[] = [
      { metadata: testProviderMetadata('fake-provider-a'), adapter: adapterA },
      { metadata: testProviderMetadata('fake-provider-b'), adapter: adapterB },
    ];

    await makeRefresh(registrations, 'fake-provider-a', clock).execute({ gardenId });
    clock.advanceMs(FRESHNESS.observationFreshForMs + 1);
    // The replacement: the SAME machinery, a different configured key.
    await makeRefresh(registrations, 'fake-provider-b', clock).execute({ gardenId });

    expect(adapterA.callCount).toBe(1);
    expect(adapterB.callCount).toBe(1);

    const rows = await db
      .selectFrom('integrations.weather_record')
      .select(['provider_key', 'license_note'])
      .where('garden_id', '=', gardenId)
      .orderBy('fetched_at')
      .execute();
    expect(rows).toEqual([
      {
        provider_key: 'fake-provider-a',
        license_note: 'fake-provider-a test license: internal use only',
      },
      {
        provider_key: 'fake-provider-b',
        license_note: 'fake-provider-b test license: internal use only',
      },
    ]);

    // The latest read now serves provider B; provider A's record is
    // untouched history, not silently rewritten.
    const latest = await new KyselyWeatherRecordRepository(db).findLatest(gardenId, 'observation');
    expect(latest?.providerKey).toBe('fake-provider-b');
  });
});
