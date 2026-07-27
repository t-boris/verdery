/**
 * Full-stack integration tests for P9D-SEASON-DATA-01 against real
 * PostgreSQL: the `plant_revision` placement/taxon snapshot (proving each
 * command populates exactly the fields it changed, and only those), the
 * bed-occupancy-history reconstruction query, and the
 * `taxonomy_seasonal_fact` review-status filter — this stage's own named
 * completion evidence ("Horticulture-reviewed seasonal fixtures").
 *
 * Split from `plants-inventory.test.ts`/`plants-inventory-photos-
 * identification.test.ts` for the same 600-line reason those two are split
 * from each other.
 *
 * Source: tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 1 —
 *         P9D-SEASON-DATA-01";
 *         migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Geometry } from '@verdery/geometry-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { AttachPlantPhoto } from '../../src/modules/plants-inventory/application/attach-plant-photo.js';
import { ConfirmPlantIdentification } from '../../src/modules/plants-inventory/application/confirm-plant-identification.js';
import { MovePlant } from '../../src/modules/plants-inventory/application/move-plant.js';
import { SetPlantStatus } from '../../src/modules/plants-inventory/application/set-plant-status.js';
import { TransitionPlantLifecycleStage } from '../../src/modules/plants-inventory/application/transition-plant-lifecycle-stage.js';
import { UpdatePlantDetails } from '../../src/modules/plants-inventory/application/update-plant-details.js';
import { KyselyBedOccupancyHistoryReader } from '../../src/modules/plants-inventory/persistence/kysely-bed-occupancy-history-reader.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { KyselyTaxonomySeasonalFactRepository } from '../../src/modules/plants-inventory/persistence/kysely-taxonomy-seasonal-fact-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plants-inventory seasonal facts and bed occupancy integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

const BED_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

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

  async function createBed(gardenId: string, ownerId: string, clock: Clock): Promise<string> {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const createMapObject = new CreateMapObject(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      authorization,
      clock,
    );
    const objectId = generateUuidV7();
    await createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );
    return objectId;
  }

  async function insertTaxonomyReference(scientificName: string): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id,
        scientific_name: scientificName,
        common_name: null,
        variety_name: null,
        family: null,
        genus: null,
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
      plantRepository,
      addPlant: new AddPlant(idempotency, unitOfWork, authorization, clock),
      movePlant: new MovePlant(plantRepository, idempotency, unitOfWork, authorization, clock),
      updatePlantDetails: new UpdatePlantDetails(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      transitionPlantLifecycleStage: new TransitionPlantLifecycleStage(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      setPlantStatus: new SetPlantStatus(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      attachPlantPhoto: new AttachPlantPhoto(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
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

  async function revisionRow(plantId: string, revision: number) {
    return db
      .selectFrom('plants_inventory.plant_revision')
      .select([
        'command_type',
        'garden_area_map_object_id',
        'placement_map_object_id',
        'taxonomy_reference_id',
      ])
      .where('plant_id', '=', plantId)
      .where('revision', '=', revision)
      .executeTakeFirstOrThrow();
  }

  async function registerAvailableMedia(
    ownerId: string,
    gardenId: string,
    clock: Clock,
  ): Promise<string> {
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

  describe('plant_revision placement/taxon snapshot', () => {
    it('populates the full snapshot on createPlant, only placement on movePlant, only taxonomy on confirmIdentification/updateDetails, and nulls out lifecycle/status-only commands', async () => {
      const now = new Date('2026-07-25T09:00:00Z');
      const { ownerId, gardenId } = await createGardenWithOwner(now);
      const handlers = buildHandlers(fixedClock(now));
      const bedA = await createBed(gardenId, ownerId, fixedClock(now));
      const bedB = await createBed(gardenId, ownerId, fixedClock(now));
      const taxonA = await insertTaxonomyReference('Solanum lycopersicum');
      const taxonB = await insertTaxonomyReference('Ocimum basilicum');

      const plant = await handlers.addPlant.execute(
        gardenId,
        ownerId,
        {
          displayName: 'Tomato',
          groupingKind: 'individual',
          gardenAreaMapObjectId: bedA,
          taxonomyReferenceId: taxonA,
        },
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, 1)).toMatchObject({
        command_type: 'addPlant',
        garden_area_map_object_id: bedA,
        placement_map_object_id: null,
        taxonomy_reference_id: taxonA,
      });

      const moved = await handlers.movePlant.execute(
        plant.id,
        ownerId,
        plant.revision,
        { gardenAreaMapObjectId: bedB },
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, moved.revision)).toMatchObject({
        command_type: 'movePlant',
        garden_area_map_object_id: bedB,
        placement_map_object_id: null,
        taxonomy_reference_id: null,
      });

      const reidentified = await handlers.updatePlantDetails.execute(
        plant.id,
        ownerId,
        moved.revision,
        { taxonomyReferenceId: taxonB },
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, reidentified.revision)).toMatchObject({
        command_type: 'updateDetails',
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        taxonomy_reference_id: taxonB,
      });

      const renamed = await handlers.updatePlantDetails.execute(
        plant.id,
        ownerId,
        reidentified.revision,
        { displayName: 'Genovese Basil' },
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, renamed.revision)).toMatchObject({
        command_type: 'updateDetails',
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        // taxonomyReferenceId was NOT named in this call's changes, so it
        // stays null even though the plant currently has one.
        taxonomy_reference_id: null,
      });

      const flowering = await handlers.transitionPlantLifecycleStage.execute(
        plant.id,
        ownerId,
        renamed.revision,
        'flowering',
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, flowering.revision)).toMatchObject({
        command_type: 'transitionLifecycleStage',
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        taxonomy_reference_id: null,
      });

      const dormant = await handlers.setPlantStatus.execute(
        plant.id,
        ownerId,
        flowering.revision,
        'dormant',
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, dormant.revision)).toMatchObject({
        command_type: 'setStatus',
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        taxonomy_reference_id: null,
      });

      // confirmIdentification changes taxonomyReferenceId too — proven
      // separately below since it needs a plant_photo/plant_identification
      // pair, not because its own snapshot rule differs.
      const mediaId = await registerAvailableMedia(ownerId, gardenId, fixedClock(now));
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
          suggested_taxonomy_id: taxonA,
          confidence_score: 0.9,
        })
        .execute();
      const confirmed = await handlers.confirmPlantIdentification.execute(
        plant.id,
        ownerId,
        identificationId,
        dormant.revision,
        generateUuidV7(),
      );
      expect(await revisionRow(plant.id, confirmed.revision)).toMatchObject({
        command_type: 'confirmIdentification',
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        taxonomy_reference_id: taxonA,
      });
    });
  });

  describe('bed occupancy history', () => {
    it('attributes each interval to the right plant/taxon: placed in bed A, moved to bed B, a second plant placed in bed A afterward', async () => {
      const now = new Date('2026-03-01T09:00:00Z');
      const { ownerId, gardenId } = await createGardenWithOwner(now);
      const handlers = buildHandlers(fixedClock(now));
      const bedA = await createBed(gardenId, ownerId, fixedClock(now));
      const bedB = await createBed(gardenId, ownerId, fixedClock(now));
      const taxonTomato = await insertTaxonomyReference('Solanum lycopersicum');
      const taxonBasil = await insertTaxonomyReference('Ocimum basilicum');

      const tomato = await handlers.addPlant.execute(
        gardenId,
        ownerId,
        {
          displayName: 'Tomato',
          groupingKind: 'individual',
          gardenAreaMapObjectId: bedA,
          taxonomyReferenceId: taxonTomato,
        },
        generateUuidV7(),
      );

      await handlers.movePlant.execute(
        tomato.id,
        ownerId,
        tomato.revision,
        { gardenAreaMapObjectId: bedB },
        generateUuidV7(),
      );

      const basil = await handlers.addPlant.execute(
        gardenId,
        ownerId,
        {
          displayName: 'Basil',
          groupingKind: 'individual',
          gardenAreaMapObjectId: bedA,
          taxonomyReferenceId: taxonBasil,
        },
        generateUuidV7(),
      );

      const reader = new KyselyBedOccupancyHistoryReader(db);
      const wideStart = new Date('2000-01-01T00:00:00Z');
      const wideEnd = new Date('2100-01-01T00:00:00Z');

      const bedAHistory = await reader.findForBed(bedA, wideStart, wideEnd);
      expect(bedAHistory).toHaveLength(2);
      expect(bedAHistory[0]).toMatchObject({
        plantId: tomato.id,
        taxonomyReferenceId: taxonTomato,
      });
      expect(bedAHistory[0]?.occupiedUntil).not.toBeNull();
      expect(bedAHistory[1]).toMatchObject({
        plantId: basil.id,
        taxonomyReferenceId: taxonBasil,
        occupiedUntil: null,
      });
      expect(bedAHistory[0]!.occupiedFrom.getTime()).toBeLessThanOrEqual(
        bedAHistory[1]!.occupiedFrom.getTime(),
      );

      const bedBHistory = await reader.findForBed(bedB, wideStart, wideEnd);
      expect(bedBHistory).toHaveLength(1);
      expect(bedBHistory[0]).toMatchObject({
        plantId: tomato.id,
        taxonomyReferenceId: taxonTomato,
        occupiedUntil: null,
      });
      // `occupiedFrom` comes from `plant_revision.recorded_at`, the real
      // database clock at insert time — a different clock than the
      // application-injected `fixedClock` this test otherwise runs under
      // (which drives `plant.updatedAt`), so only a sanity range check
      // against wall-clock time is meaningful here. The MEANINGFUL
      // correctness check is the line just below: bed A's own closing
      // instant for this plant must equal bed B's own opening instant,
      // since both are read off the exact same `movePlant` journal row.
      expect(bedBHistory[0]!.occupiedFrom.getTime()).toBeGreaterThan(Date.now() - 5 * 60 * 1000);
      expect(bedAHistory[0]!.occupiedUntil?.getTime()).toBe(bedBHistory[0]!.occupiedFrom.getTime());
    });

    it('attributes an identification confirmed WHILE still in the bed to that bed, even though it came from a different command than the placement', async () => {
      const now = new Date('2026-03-01T09:00:00Z');
      const { ownerId, gardenId } = await createGardenWithOwner(now);
      const handlers = buildHandlers(fixedClock(now));
      const bedA = await createBed(gardenId, ownerId, fixedClock(now));
      const taxonTomato = await insertTaxonomyReference('Solanum lycopersicum');

      const plant = await handlers.addPlant.execute(
        gardenId,
        ownerId,
        {
          displayName: 'Unidentified seedling',
          groupingKind: 'individual',
          gardenAreaMapObjectId: bedA,
        },
        generateUuidV7(),
      );

      const mediaId = await registerAvailableMedia(ownerId, gardenId, fixedClock(now));
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
          suggested_taxonomy_id: taxonTomato,
          confidence_score: 0.95,
        })
        .execute();
      await handlers.confirmPlantIdentification.execute(
        plant.id,
        ownerId,
        identificationId,
        plant.revision,
        generateUuidV7(),
      );

      const reader = new KyselyBedOccupancyHistoryReader(db);
      const history = await reader.findForBed(
        bedA,
        new Date('2000-01-01T00:00:00Z'),
        new Date('2100-01-01T00:00:00Z'),
      );
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ plantId: plant.id, taxonomyReferenceId: taxonTomato });
    });
  });

  describe('taxonomy_seasonal_fact review-status filter', () => {
    it('surfaces only the horticulturally_reviewed fact, excluding an awaiting_horticultural_review row for the same taxon', async () => {
      const taxonomyId = await insertTaxonomyReference('Daucus carota');

      await db
        .insertInto('plants_inventory.taxonomy_seasonal_fact')
        .values({
          id: randomUUID(),
          taxonomy_reference_id: taxonomyId,
          hemisphere: 'northern',
          sow_outdoors_start_month: 3,
          sow_outdoors_end_month: 5,
          days_to_maturity_min: 60,
          days_to_maturity_max: 80,
          authoring_method: 'ai_extracted_from_source',
          source_citation: 'USDA Plant Characteristics, accessed 2026-03-01',
          review_status: 'horticulturally_reviewed',
          reviewed_by: 'Dr. Amara Osei',
          reviewed_on: '2026-03-15',
        })
        .execute();

      // Same taxon, the OTHER hemisphere, deliberately still unreviewed —
      // "ship honestly unreviewed", the same precedent every launch rule's
      // own review metadata already sets.
      await db
        .insertInto('plants_inventory.taxonomy_seasonal_fact')
        .values({
          id: randomUUID(),
          taxonomy_reference_id: taxonomyId,
          hemisphere: 'southern',
          sow_outdoors_start_month: 9,
          sow_outdoors_end_month: 11,
          authoring_method: 'human_authored',
          review_status: 'awaiting_horticultural_review',
        })
        .execute();

      const repository = new KyselyTaxonomySeasonalFactRepository(db);

      const reviewed = await repository.findReviewedForTaxonomyAndHemisphere(
        taxonomyId,
        'northern',
      );
      expect(reviewed).toMatchObject({
        taxonomyReferenceId: taxonomyId,
        hemisphere: 'northern',
        sowOutdoorsStartMonth: 3,
        sowOutdoorsEndMonth: 5,
        daysToMaturityMin: 60,
        daysToMaturityMax: 80,
        authoringMethod: 'ai_extracted_from_source',
        sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      });

      const unreviewed = await repository.findReviewedForTaxonomyAndHemisphere(
        taxonomyId,
        'southern',
      );
      expect(unreviewed).toBeNull();
    });
  });
});
