import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { createPlantPhoto } from '../domain/plant-photo.js';
import { SearchPlants } from './search-plants.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildPlant,
  createPlantsInventoryFakes,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID_1 = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PLANT_ID_2 = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

const VIEWER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'viewer' as const,
};

describe('SearchPlants', () => {
  it('lists every plant in the garden for a caller with viewGarden, with no filters applied', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(PLANT_ID_1, buildPlant({ id: PLANT_ID_1, gardenId: GARDEN_ID }));
    fakes.plants.plants.set(PLANT_ID_2, buildPlant({ id: PLANT_ID_2, gardenId: GARDEN_ID }));
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const result = await searchPlants.execute(GARDEN_ID, PROFILE_ID, {}, null, 50);

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("carries each plant's cover photo (primary if set, else oldest) and null for a plant with none", async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(PLANT_ID_1, buildPlant({ id: PLANT_ID_1, gardenId: GARDEN_ID }));
    fakes.plants.plants.set(PLANT_ID_2, buildPlant({ id: PLANT_ID_2, gardenId: GARDEN_ID }));
    const oldest = createPlantPhoto(
      'photo-1',
      PLANT_ID_1,
      'media-oldest',
      false,
      new Date('2026-01-01T00:00:00Z'),
    );
    const primary = createPlantPhoto(
      'photo-2',
      PLANT_ID_1,
      'media-primary',
      true,
      new Date('2026-01-02T00:00:00Z'),
    );
    fakes.plantPhotos.photos.set(oldest.id, oldest);
    fakes.plantPhotos.photos.set(primary.id, primary);
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const result = await searchPlants.execute(GARDEN_ID, PROFILE_ID, {}, null, 50);

    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(byId.get(PLANT_ID_1)?.coverMediaId).toBe('media-primary');
    expect(byId.get(PLANT_ID_2)?.coverMediaId).toBeNull();
  });

  it('rejects a caller with no membership on the garden, concealing it as not found', async () => {
    const fakes = createPlantsInventoryFakes();
    const searchPlants = new SearchPlants(fakes.plants, authorizationDenying(), fakes.plantPhotos);

    await expect(searchPlants.execute(GARDEN_ID, PROFILE_ID, {}, null, 50)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('trims a text query and treats a blank query the same as no query', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(
      PLANT_ID_1,
      buildPlant({ id: PLANT_ID_1, gardenId: GARDEN_ID, displayName: 'Roma Tomato' }),
    );
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const trimmed = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { query: '  tomato  ' },
      null,
      50,
    );
    expect(trimmed.items).toHaveLength(1);

    const blank = await searchPlants.execute(GARDEN_ID, PROFILE_ID, { query: '   ' }, null, 50);
    expect(blank.items).toHaveLength(1);
  });

  it('applies lifecycleStage, status, and groupingKind filters individually and combined', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(
      PLANT_ID_1,
      buildPlant({
        id: PLANT_ID_1,
        gardenId: GARDEN_ID,
        lifecycleStage: 'flowering',
        status: 'active',
        groupingKind: 'individual',
      }),
    );
    fakes.plants.plants.set(
      PLANT_ID_2,
      buildPlant({
        id: PLANT_ID_2,
        gardenId: GARDEN_ID,
        lifecycleStage: 'seedling',
        status: 'dormant',
        groupingKind: 'row',
      }),
    );
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const byLifecycleStage = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { lifecycleStage: ['flowering'] },
      null,
      50,
    );
    expect(byLifecycleStage.items.map((p) => p.id)).toEqual([PLANT_ID_1]);

    const byStatus = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { status: ['dormant'] },
      null,
      50,
    );
    expect(byStatus.items.map((p) => p.id)).toEqual([PLANT_ID_2]);

    const byGroupingKind = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { groupingKind: ['row'] },
      null,
      50,
    );
    expect(byGroupingKind.items.map((p) => p.id)).toEqual([PLANT_ID_2]);

    const combined = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { status: ['active'], lifecycleStage: ['flowering'], groupingKind: ['individual'] },
      null,
      50,
    );
    expect(combined.items.map((p) => p.id)).toEqual([PLANT_ID_1]);

    const noMatch = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { status: ['active'], lifecycleStage: ['seedling'] },
      null,
      50,
    );
    expect(noMatch.items).toHaveLength(0);
  });

  it('filters by identified state (P11-SEARCH-01)', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(
      PLANT_ID_1,
      buildPlant({
        id: PLANT_ID_1,
        gardenId: GARDEN_ID,
        taxonomyReferenceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      }),
    );
    fakes.plants.plants.set(
      PLANT_ID_2,
      buildPlant({ id: PLANT_ID_2, gardenId: GARDEN_ID, taxonomyReferenceId: null }),
    );
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const identified = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { identified: true },
      null,
      50,
    );
    expect(identified.items.map((p) => p.id)).toEqual([PLANT_ID_1]);

    const unidentified = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { identified: false },
      null,
      50,
    );
    expect(unidentified.items.map((p) => p.id)).toEqual([PLANT_ID_2]);
  });

  it('finds unassigned plants and resolves the plant linked to one map object', async () => {
    const fakes = createPlantsInventoryFakes();
    const mapObjectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';
    fakes.plants.plants.set(
      PLANT_ID_1,
      buildPlant({ id: PLANT_ID_1, gardenId: GARDEN_ID, placementMapObjectId: mapObjectId }),
    );
    fakes.plants.plants.set(
      PLANT_ID_2,
      buildPlant({ id: PLANT_ID_2, gardenId: GARDEN_ID, placementMapObjectId: null }),
    );
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const unassigned = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { hasMapPlacement: false },
      null,
      50,
    );
    const linked = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { placementMapObjectId: mapObjectId },
      null,
      50,
    );

    expect(unassigned.items.map((plant) => plant.id)).toEqual([PLANT_ID_2]);
    expect(linked.items.map((plant) => plant.id)).toEqual([PLANT_ID_1]);
  });

  it('treats an empty filter array the same as an omitted filter', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(PLANT_ID_1, buildPlant({ id: PLANT_ID_1, gardenId: GARDEN_ID }));
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const result = await searchPlants.execute(
      GARDEN_ID,
      PROFILE_ID,
      { status: [], lifecycleStage: [], groupingKind: [] },
      null,
      50,
    );
    expect(result.items).toHaveLength(1);
  });

  it('passes the cursor and limit through to the repository and forwards its nextCursor', async () => {
    const fakes = createPlantsInventoryFakes();
    for (let i = 0; i < 3; i += 1) {
      fakes.plants.plants.set(
        `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1${String(i)}`,
        buildPlant({
          id: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1${String(i)}`,
          gardenId: GARDEN_ID,
          createdAt: new Date(2026, 0, i + 1),
        }),
      );
    }
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const first = await searchPlants.execute(GARDEN_ID, PROFILE_ID, {}, null, 2);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await searchPlants.execute(GARDEN_ID, PROFILE_ID, {}, first.nextCursor, 2);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('does not return a plant belonging to a different garden', async () => {
    const otherGardenId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9aff';
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(PLANT_ID_1, buildPlant({ id: PLANT_ID_1, gardenId: GARDEN_ID }));
    fakes.plants.plants.set(PLANT_ID_2, buildPlant({ id: PLANT_ID_2, gardenId: otherGardenId }));
    const searchPlants = new SearchPlants(
      fakes.plants,
      authorizationGranting(VIEWER_MEMBERSHIP),
      fakes.plantPhotos,
    );

    const result = await searchPlants.execute(GARDEN_ID, PROFILE_ID, {}, null, 50);
    expect(result.items.map((p) => p.id)).toEqual([PLANT_ID_1]);
  });
});
