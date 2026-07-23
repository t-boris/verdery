import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { MapObjectSummary } from '../../gardens-mapping/public.js';
import { MovePlant } from './move-plant.js';
import {
  authorizationGranting,
  buildPlant,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const MAP_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const FOREIGN_MAP_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function activeMapObjectSummary(id: string, gardenId: string): MapObjectSummary {
  return { id, gardenId, category: 'bed', lifecycleState: 'active', currentRevision: 1 };
}

describe('MovePlant', () => {
  it('updates placement fields only, leaving gardenId unchanged', async () => {
    const fakes = createPlantsInventoryFakes(
      new Map([[MAP_OBJECT_ID, activeMapObjectSummary(MAP_OBJECT_ID, GARDEN_ID)]]),
    );
    fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
    const movePlant = new MovePlant(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await movePlant.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      { gardenAreaMapObjectId: MAP_OBJECT_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
    );

    expect(result.gardenAreaMapObjectId).toBe(MAP_OBJECT_ID);
    expect(result.gardenId).toBe(GARDEN_ID);
    expect(result.revision).toBe(2);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: PLANT_ID,
        revision: 2,
        commandType: 'movePlant',
        lifecycleStage: null,
        status: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('rejects a placement referencing a map object from a different garden, even one that really exists', async () => {
    const fakes = createPlantsInventoryFakes(
      new Map([
        [FOREIGN_MAP_OBJECT_ID, activeMapObjectSummary(FOREIGN_MAP_OBJECT_ID, OTHER_GARDEN_ID)],
      ]),
    );
    fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
    const movePlant = new MovePlant(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      movePlant.execute(
        PLANT_ID,
        PROFILE_ID,
        1,
        { placementMapObjectId: FOREIGN_MAP_OBJECT_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('clears placement fields when omitted', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(
      PLANT_ID,
      buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID, gardenAreaMapObjectId: MAP_OBJECT_ID }),
    );
    const movePlant = new MovePlant(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await movePlant.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      {},
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
    );

    expect(result.gardenAreaMapObjectId).toBeNull();
  });
});
