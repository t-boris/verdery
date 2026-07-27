/**
 * Full-stack integration test for hemisphere derivation (P9D-SEASON-DATA-01)
 * against real PostgreSQL/PostGIS: the real `KyselyGeoreferenceRepository`
 * reading a real `gardens_mapping.georeference` row, composed with the pure
 * `deriveHemisphere` function — proving the whole real path (PostGIS point
 * storage/parsing, coordinate ordering, sign derivation) end to end, not
 * only the pure function in isolation
 * (`src/modules/tasks-recommendations/domain/garden-facts.test.ts`).
 *
 * A georeferenced garden in each hemisphere, and an ungeoreferenced garden
 * yielding `null` — this stage's own named test requirement.
 *
 * Source: tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 1 —
 *         P9D-SEASON-DATA-01".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KyselyGeoreferenceRepository } from '../../src/modules/gardens-mapping/persistence/kysely-georeference-repository.js';
import { deriveHemisphere } from '../../src/modules/tasks-recommendations/domain/garden-facts.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'garden hemisphere derivation integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

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

  async function insertGarden(name: string): Promise<string> {
    const gardenId = randomUUID();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name,
        lifecycle_state: 'active',
        created_by_profile_id: profileId,
      })
      .execute();
    return gardenId;
  }

  /** A garden with a current georeference anchored at `[longitude, latitude]` — mirrors `integrations-weather.test.ts`'s own identical helper. */
  async function insertGeoreferencedGarden(longitude: number, latitude: number): Promise<string> {
    const gardenId = await insertGarden('Georeferenced garden');
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

  it('derives northern for a garden georeferenced at a positive latitude (Amsterdam)', async () => {
    const gardenId = await insertGeoreferencedGarden(4.895, 52.37);
    const repository = new KyselyGeoreferenceRepository(db);

    const georeference = await repository.findCurrentForGarden(gardenId);
    expect(georeference).not.toBeNull();
    expect(deriveHemisphere(georeference?.geographicAnchor ?? null)).toBe('northern');
  });

  it('derives southern for a garden georeferenced at a negative latitude (Sydney)', async () => {
    const gardenId = await insertGeoreferencedGarden(151.21, -33.87);
    const repository = new KyselyGeoreferenceRepository(db);

    const georeference = await repository.findCurrentForGarden(gardenId);
    expect(georeference).not.toBeNull();
    expect(deriveHemisphere(georeference?.geographicAnchor ?? null)).toBe('southern');
  });

  it('derives null for a garden that has never been georeferenced', async () => {
    const gardenId = await insertGarden('Ungeoreferenced garden');
    const repository = new KyselyGeoreferenceRepository(db);

    const georeference = await repository.findCurrentForGarden(gardenId);
    expect(georeference).toBeNull();
    expect(deriveHemisphere(georeference?.geographicAnchor ?? null)).toBeNull();
  });
});
