/**
 * Full-stack integration tests for the plants-inventory module's photo,
 * photo-identification, and taxonomy-search commands against real
 * PostgreSQL/PostGIS — the sibling half of
 * `plants-inventory.test.ts`, split for the same 600-line reason
 * `map-objects.test.ts`/`map-objects-relationships.test.ts` are.
 *
 * Covers `AddPlantFromPhoto`, `AttachPlantPhoto`, `SetPrimaryPlantPhoto`,
 * `ConfirmPlantIdentification`, and `SearchTaxonomyReferences`.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql;
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
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { AddPlantFromPhoto } from '../../src/modules/plants-inventory/application/add-plant-from-photo.js';
import { AttachPlantPhoto } from '../../src/modules/plants-inventory/application/attach-plant-photo.js';
import { ConfirmPlantIdentification } from '../../src/modules/plants-inventory/application/confirm-plant-identification.js';
import { SearchTaxonomyReferences } from '../../src/modules/plants-inventory/application/search-taxonomy-references.js';
import { SetPrimaryPlantPhoto } from '../../src/modules/plants-inventory/application/set-primary-plant-photo.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { KyselyTaxonomyReferenceRepository } from '../../src/modules/plants-inventory/persistence/kysely-taxonomy-reference-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'plants-inventory photos and identification integration';
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

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
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

  async function createGardenWithOwner(now: Date) {
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);

    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    return { ownerId, gardenId: garden.id };
  }

  async function registerMedia(ownerId: string, clock: Clock): Promise<string> {
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
    return media.id;
  }

  async function insertTaxonomyReference(
    scientificName: string,
    commonName: string,
  ): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id,
        scientific_name: scientificName,
        common_name: commonName,
        variety_name: null,
        source: 'system_catalog',
        created_by_profile_id: null,
      })
      .execute();
    return id;
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const plantRepository = new KyselyPlantRepository(db);

    return {
      addPlant: new AddPlant(idempotency, unitOfWork, authorization, clock),
      addPlantFromPhoto: new AddPlantFromPhoto(idempotency, unitOfWork, authorization, clock),
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
      confirmPlantIdentification: new ConfirmPlantIdentification(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
    };
  }

  it('creates a plant from a photo with one plant_photo and one plant_identification row, taxonomyReferenceId staying null', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const mediaId = await registerMedia(ownerId, fixedClock(now));

    const plant = await handlers.addPlantFromPhoto.execute(
      gardenId,
      ownerId,
      { photoMediaId: mediaId },
      generateUuidV7(),
    );

    expect(plant.taxonomyReferenceId).toBeNull();
    expect(plant.groupingKind).toBe('individual');

    const photoRow = await db
      .selectFrom('plants_inventory.plant_photo')
      .selectAll()
      .where('plant_id', '=', plant.id)
      .executeTakeFirstOrThrow();
    expect(photoRow).toMatchObject({ media_id: mediaId, is_primary: true });

    const identificationRow = await db
      .selectFrom('plants_inventory.plant_identification')
      .selectAll()
      .where('plant_id', '=', plant.id)
      .executeTakeFirstOrThrow();
    expect(identificationRow).toMatchObject({
      plant_photo_id: photoRow.id,
      suggested_taxonomy_id: null,
    });
    expect(Number(identificationRow.confidence_score)).toBe(0);
  });

  it('attaches a second photo and moves primary between photos without violating the partial unique index', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const firstMediaId = await registerMedia(ownerId, fixedClock(now));
    const secondMediaId = await registerMedia(ownerId, fixedClock(now));

    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const firstPhoto = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId: firstMediaId, isPrimary: true },
      generateUuidV7(),
    );
    const secondPhoto = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId: secondMediaId, isPrimary: true },
      generateUuidV7(),
    );

    const primaryRows = await db
      .selectFrom('plants_inventory.plant_photo')
      .select(['id', 'is_primary'])
      .where('plant_id', '=', plant.id)
      .where('is_primary', '=', true)
      .execute();
    expect(primaryRows).toEqual([{ id: secondPhoto.id, is_primary: true }]);

    const flipped = await handlers.setPrimaryPlantPhoto.execute(
      plant.id,
      ownerId,
      firstPhoto.id,
      generateUuidV7(),
    );
    expect(flipped.isPrimary).toBe(true);

    const primaryAfterFlip = await db
      .selectFrom('plants_inventory.plant_photo')
      .select(['id'])
      .where('plant_id', '=', plant.id)
      .where('is_primary', '=', true)
      .execute();
    expect(primaryAfterFlip).toEqual([{ id: firstPhoto.id }]);

    // Neither AttachPlantPhoto nor SetPrimaryPlantPhoto bumps plant.revision
    // (see both commands' own doc comments), but each still writes its own
    // sync_change row for the *plant* — a puller must learn its photos
    // changed even though the plant's own revision stayed put. Four
    // sync_change rows total, all at revision 1: addPlant, the two
    // AttachPlantPhoto calls, and the SetPrimaryPlantPhoto flip.
    const syncChangeRows = await db
      .selectFrom('platform.sync_change')
      .select(['record_revision', 'operation'])
      .where('record_id', '=', plant.id)
      .where('record_type', '=', 'plant')
      .orderBy('sequence', 'asc')
      .execute();
    expect(syncChangeRows).toEqual([
      { record_revision: 1, operation: 'upsert' },
      { record_revision: 1, operation: 'upsert' },
      { record_revision: 1, operation: 'upsert' },
      { record_revision: 1, operation: 'upsert' },
    ]);
  });

  it('confirms an identification, resolving the accepted_identification_id circular FK, and rejects a mismatched plant', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const taxonomyId = await insertTaxonomyReference('Solanum lycopersicum', 'Tomato');
    const mediaId = await registerMedia(ownerId, fixedClock(now));

    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Unidentified plant', groupingKind: 'individual' },
      generateUuidV7(),
    );
    const photo = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId, isPrimary: true },
      generateUuidV7(),
    );
    const identificationId = generateUuidV7();
    await db
      .insertInto('plants_inventory.plant_identification')
      .values({
        id: identificationId,
        plant_id: plant.id,
        plant_photo_id: photo.id,
        suggested_taxonomy_id: taxonomyId,
        confidence_score: 0.92,
      })
      .execute();

    const confirmed = await handlers.confirmPlantIdentification.execute(
      plant.id,
      ownerId,
      identificationId,
      plant.revision,
      generateUuidV7(),
    );

    expect(confirmed.taxonomyReferenceId).toBe(taxonomyId);
    expect(confirmed.acceptedIdentificationId).toBe(identificationId);

    const plantRow = await db
      .selectFrom('plants_inventory.plant')
      .select(['taxonomy_reference_id', 'accepted_identification_id'])
      .where('id', '=', plant.id)
      .executeTakeFirstOrThrow();
    expect(plantRow.taxonomy_reference_id).toBe(taxonomyId);
    expect(plantRow.accepted_identification_id).toBe(identificationId);

    const otherPlant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Basil', groupingKind: 'individual' },
      generateUuidV7(),
    );
    await expect(
      handlers.confirmPlantIdentification.execute(
        otherPlant.id,
        ownerId,
        identificationId,
        otherPlant.revision,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    await expect(
      handlers.confirmPlantIdentification.execute(
        plant.id,
        ownerId,
        generateUuidV7(),
        confirmed.revision,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // A short, high-entropy suffix distinct from the one an earlier version of
  // this test used (`generateUuidV7().slice(0, 8)`): a UUIDv7's *leading*
  // characters are its millisecond timestamp, not random — two calls made
  // moments apart within the same test run share most of that prefix, which
  // is exactly the collision this helper exists to avoid. The *trailing*
  // characters fall entirely within UUIDv7's random bits instead.
  function uniqueSuffix(): string {
    return generateUuidV7().slice(-8);
  }

  it('searches the taxonomy catalog by scientific and common name, case-insensitively', async () => {
    // Species unrelated to 'Solanum lycopersicum'/'Tomato' — the pair the
    // "confirms an identification" test above already inserted, bare, with
    // no suffix, into this same shared container/database. Trigram
    // similarity (unlike the plain `ILIKE` substring match this replaced in
    // P4-SEARCH-01) is a fuzzy match: a query built from a real word like
    // 'tomato' scores well above this repository's own 0.25 threshold
    // against that unrelated bare row too (confirmed directly against a real
    // Postgres instance: `similarity('Tomato', 'tomato <suffix>')` ≈ 0.44),
    // so reusing 'Tomato'/'Solanum lycopersicum' here — suffixed or not —
    // would make the exact-match assertions below depend on which other
    // tests already ran. Each row here also gets its own random suffix, not
    // one shared across both, for the same reason: a shared suffix makes the
    // two rows partially match each other's query purely from that shared
    // tail.
    const roseSuffix = uniqueSuffix();
    const lavenderSuffix = uniqueSuffix();
    await insertTaxonomyReference(`Rosa damascena ${roseSuffix}`, `Damask Rose ${roseSuffix}`);
    await insertTaxonomyReference(
      `Lavandula angustifolia ${lavenderSuffix}`,
      `English Lavender ${lavenderSuffix}`,
    );

    const search = new SearchTaxonomyReferences(new KyselyTaxonomyReferenceRepository(db));

    const byCommonName = await search.execute(`damask rose ${roseSuffix}`);
    expect(byCommonName.map((r) => r.scientificName)).toEqual([`Rosa damascena ${roseSuffix}`]);

    const byScientificName = await search.execute(`angustifolia ${lavenderSuffix}`);
    expect(byScientificName.map((r) => r.commonName)).toEqual([
      `English Lavender ${lavenderSuffix}`,
    ]);

    const all = await search.execute(null);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('finds a misspelled query via trigram similarity, which the plain substring match it replaced would miss', async () => {
    // 'Zucchini', not 'Tomato' — see the previous test's own comment for why
    // this file's other, unrelated 'Tomato'/'Solanum lycopersicum' fixture
    // rules that word out here too.
    const suffix = uniqueSuffix();
    await insertTaxonomyReference(`Cucurbita pepo ${suffix}`, `Zucchini ${suffix}`);

    const search = new SearchTaxonomyReferences(new KyselyTaxonomyReferenceRepository(db));

    // 'zuchinni' is not a substring of 'Zucchini <suffix>' in either
    // direction, so the old `ILIKE '%zuchinni%'` algorithm this replaces
    // would find nothing here — trigram similarity tolerates the misspelling.
    const results = await search.execute(`zuchinni ${suffix}`);
    expect(results.map((r) => r.commonName)).toEqual([`Zucchini ${suffix}`]);
  });
});
