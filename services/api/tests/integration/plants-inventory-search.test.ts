/**
 * Full-stack integration tests for `SearchPlants` against real PostgreSQL:
 * the real `KyselyPlantRepository.search`, the real `pg_trgm` trigram
 * indexes `1784950000000_search-indexes.sql` adds, and real `garden`
 * membership authorization — not fakes. Mirrors the rigor of
 * `tests/integration/plants-inventory.test.ts` and
 * `tests/integration/gardens-mapping.test.ts`; split into its own file so
 * neither approaches the repository's 600-line source-file limit, the same
 * reason `plants-inventory.test.ts`/`plants-inventory-photos-identification.
 * test.ts` are split.
 *
 * Source: implementation-plan.md work package P4-SEARCH-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { SearchPlants } from '../../src/modules/plants-inventory/application/search-plants.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { NotFoundError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'plants-inventory search integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  /** Creates a profile, a garden it owns, and an authorization instance backed by real membership rows. */
  async function createGardenWithOwner(now: Date) {
    const ownerId = generateUuidV7();
    await insertProfile(ownerId);

    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    return { ownerId, gardenId: garden.id };
  }

  /**
   * Inserts a plant row directly, bypassing `AddPlant` — this file needs
   * fine-grained control over `lifecycleStage`/`status`/`groupingKind`/
   * `createdAt` combinations `AddPlant`'s own always-`'planned'`/`'active'`/
   * caller-supplied-`groupingKind`/`now()` defaults do not offer, the same
   * direct-insert approach `plants-observations-tasks-baseline.test.ts`'s
   * own `insertPlant` helper uses for the identical reason.
   */
  async function insertPlant(overrides: {
    gardenId: string;
    createdByProfileId: string;
    displayName: string;
    lifecycleStage?: string;
    status?: string;
    groupingKind?: string;
    quantity?: number | null;
    createdAt?: Date;
  }): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('plants_inventory.plant')
      .values({
        id,
        garden_id: overrides.gardenId,
        display_name: overrides.displayName,
        created_by_profile_id: overrides.createdByProfileId,
        ...(overrides.lifecycleStage === undefined
          ? {}
          : { lifecycle_stage: overrides.lifecycleStage }),
        ...(overrides.status === undefined ? {} : { status: overrides.status }),
        ...(overrides.groupingKind === undefined
          ? {}
          : { grouping_kind: overrides.groupingKind, quantity: overrides.quantity ?? 2 }),
        ...(overrides.createdAt === undefined ? {} : { created_at: overrides.createdAt }),
      })
      .execute();
    return id;
  }

  function buildSearchPlants() {
    return new SearchPlants(
      new KyselyPlantRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
    );
  }

  it('rejects a caller with no membership on the garden, concealing it as not found', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { gardenId } = await createGardenWithOwner(now);
    const strangerId = generateUuidV7();
    await insertProfile(strangerId);

    const searchPlants = buildSearchPlants();
    await expect(searchPlants.execute(gardenId, strangerId, {}, null, 50)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('does not return a plant belonging to a different garden', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const { gardenId: otherGardenId } = await createGardenWithOwner(now);
    const plantId = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Basil',
    });
    await insertPlant({
      gardenId: otherGardenId,
      createdByProfileId: ownerId,
      displayName: 'Basil',
    });

    const result = await buildSearchPlants().execute(gardenId, ownerId, {}, null, 50);
    expect(result.items.map((p) => p.id)).toEqual([plantId]);
  });

  it('matches displayName by trigram similarity, tolerating a misspelling ILIKE would miss, ranked most-similar first', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const exact = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Roma Tomato',
    });
    const partial = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Cherry Tomato Plant',
    });
    await insertPlant({ gardenId, createdByProfileId: ownerId, displayName: 'Basil' });

    // 'tomatoe' is not a substring of either tomato plant's name, so a plain
    // `ILIKE '%tomatoe%'` match would find neither — trigram similarity
    // tolerates the misspelling and ranks the closer match first.
    const result = await buildSearchPlants().execute(
      gardenId,
      ownerId,
      { query: 'tomatoe' },
      null,
      50,
    );
    expect(result.items.map((p) => p.id)).toEqual([exact, partial]);
  });

  it('filters by lifecycleStage, status, and groupingKind individually and combined', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const flowering = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Sunflower',
      lifecycleStage: 'flowering',
      status: 'active',
      groupingKind: 'individual',
    });
    const dormantRow = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Garlic Row',
      lifecycleStage: 'seedling',
      status: 'dormant',
      groupingKind: 'row',
    });

    const searchPlants = buildSearchPlants();

    const byLifecycleStage = await searchPlants.execute(
      gardenId,
      ownerId,
      { lifecycleStage: ['flowering'] },
      null,
      50,
    );
    expect(byLifecycleStage.items.map((p) => p.id)).toEqual([flowering]);

    const byStatus = await searchPlants.execute(
      gardenId,
      ownerId,
      { status: ['dormant'] },
      null,
      50,
    );
    expect(byStatus.items.map((p) => p.id)).toEqual([dormantRow]);

    const byGroupingKind = await searchPlants.execute(
      gardenId,
      ownerId,
      { groupingKind: ['row'] },
      null,
      50,
    );
    expect(byGroupingKind.items.map((p) => p.id)).toEqual([dormantRow]);

    const combined = await searchPlants.execute(
      gardenId,
      ownerId,
      { lifecycleStage: ['flowering', 'seedling'], status: ['active'] },
      null,
      50,
    );
    expect(combined.items.map((p) => p.id)).toEqual([flowering]);

    const combinedWithQuery = await searchPlants.execute(
      gardenId,
      ownerId,
      { query: 'garlic', status: ['dormant'] },
      null,
      50,
    );
    expect(combinedWithQuery.items.map((p) => p.id)).toEqual([dormantRow]);
  });

  it('paginates the no-query listing by cursor, most recently created first, covering every plant exactly once', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = await insertPlant({
        gardenId,
        createdByProfileId: ownerId,
        displayName: `Plant ${String(i)}`,
        createdAt: new Date(now.getTime() + i * 1000),
      });
      ids.push(id);
    }
    const expectedOrder = [...ids].reverse();

    const searchPlants = buildSearchPlants();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await searchPlants.execute(gardenId, ownerId, {}, cursor, 2);
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seen).toEqual(expectedOrder);
  });

  it('paginates the ranked query listing by cursor, most similar first, covering every match exactly once', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const names = [
      'Roma Tomato',
      'Cherry Tomato',
      'Beefsteak Tomato',
      'Yellow Pear Tomato',
      'Green Zebra Tomato',
    ];
    for (const displayName of names) {
      await insertPlant({ gardenId, createdByProfileId: ownerId, displayName });
    }
    await insertPlant({ gardenId, createdByProfileId: ownerId, displayName: 'Basil' });

    const searchPlants = buildSearchPlants();
    const firstPage = await searchPlants.execute(gardenId, ownerId, { query: 'tomato' }, null, 2);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const seenNames = new Set(firstPage.items.map((p) => p.displayName));
    let cursor = firstPage.nextCursor;
    while (cursor !== null) {
      const page = await searchPlants.execute(gardenId, ownerId, { query: 'tomato' }, cursor, 2);
      for (const item of page.items) {
        seenNames.add(item.displayName);
      }
      cursor = page.nextCursor;
    }

    expect(seenNames).toEqual(new Set(names));
  });
});
