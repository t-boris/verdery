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

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
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
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { AttachPlantPhoto } from '../../src/modules/plants-inventory/application/attach-plant-photo.js';
import { SearchPlants } from '../../src/modules/plants-inventory/application/search-plants.js';
import { SetPrimaryPlantPhoto } from '../../src/modules/plants-inventory/application/set-primary-plant-photo.js';
import { KyselyPlantPhotoRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-photo-repository.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { NotFoundError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plants-inventory search integration';
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
      new KyselyPlantPhotoRepository(db),
    );
  }

  /** Mirrors `plants-inventory-photos.test.ts`'s own `registerMedia` helper. */
  async function registerMedia(ownerId: string, gardenId: string, clock: Clock): Promise<string> {
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const media = await registerMediaRecord.execute(
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'plant.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      generateUuidV7(),
    );
    await db
      .updateTable('media.media_record')
      .set({ garden_id: gardenId, upload_state: 'available' })
      .where('id', '=', media.id)
      .execute();
    return media.id;
  }

  function buildPhotoHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const plantRepository = new KyselyPlantRepository(db);
    return {
      attachPlantPhoto: new AttachPlantPhoto(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      setPrimaryPlantPhoto: new SetPrimaryPlantPhoto(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
      ),
    };
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

  it('filters by identified state (P11-SEARCH-01)', async () => {
    const now = new Date('2026-07-31T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const taxonomyReferenceId = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Ocimum basilicum',
        source: 'system_catalog',
      })
      .execute();
    const identifiedPlantId = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Basil',
    });
    await db
      .updateTable('plants_inventory.plant')
      .set({ taxonomy_reference_id: taxonomyReferenceId })
      .where('id', '=', identifiedPlantId)
      .execute();
    const unidentifiedPlantId = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Mystery seedling',
    });

    const searchPlants = buildSearchPlants();

    const identified = await searchPlants.execute(
      gardenId,
      ownerId,
      { identified: true },
      null,
      50,
    );
    expect(identified.items.map((p) => p.id)).toEqual([identifiedPlantId]);

    const unidentified = await searchPlants.execute(
      gardenId,
      ownerId,
      { identified: false },
      null,
      50,
    );
    expect(unidentified.items.map((p) => p.id)).toEqual([unidentifiedPlantId]);
  });

  it("carries each plant's cover photo (the primary one, else the oldest), null for a plant with none", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const clock = fixedClock(now);
    const withPhotos = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Basil',
    });
    const withoutPhotos = await insertPlant({
      gardenId,
      createdByProfileId: ownerId,
      displayName: 'Sage',
    });

    const { attachPlantPhoto, setPrimaryPlantPhoto } = buildPhotoHandlers(clock);
    const oldestMediaId = await registerMedia(ownerId, gardenId, clock);
    await attachPlantPhoto.execute(
      withPhotos,
      ownerId,
      { mediaId: oldestMediaId },
      generateUuidV7(),
    );
    const primaryMediaId = await registerMedia(ownerId, gardenId, clock);
    const primaryPhoto = await attachPlantPhoto.execute(
      withPhotos,
      ownerId,
      { mediaId: primaryMediaId },
      generateUuidV7(),
    );
    await setPrimaryPlantPhoto.execute(withPhotos, ownerId, primaryPhoto.id, generateUuidV7());

    const result = await buildSearchPlants().execute(gardenId, ownerId, {}, null, 50);
    const byId = new Map(result.items.map((p) => [p.id, p]));
    expect(byId.get(withPhotos)?.coverMediaId).toBe(primaryMediaId);
    expect(byId.get(withoutPhotos)?.coverMediaId).toBeNull();
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
