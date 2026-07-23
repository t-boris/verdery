import { describe, expect, it } from 'vitest';
import { StaleRevisionError } from '../../../platform/errors/application-error.js';
import { TransitionPlantLifecycleStage } from './transition-plant-lifecycle-stage.js';
import {
  authorizationGranting,
  buildPlant,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithPlant() {
  const fakes = createPlantsInventoryFakes();
  fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
  return fakes;
}

describe('TransitionPlantLifecycleStage', () => {
  it('sets the new stage, bumps the revision, and journals lifecycleStage only', async () => {
    const fakes = fakesWithPlant();
    const transitionPlantLifecycleStage = new TransitionPlantLifecycleStage(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await transitionPlantLifecycleStage.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      'flowering',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.lifecycleStage).toBe('flowering');
    expect(result.status).toBe('active');
    expect(result.revision).toBe(2);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: PLANT_ID,
        revision: 2,
        commandType: 'transitionLifecycleStage',
        lifecycleStage: 'flowering',
        status: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('allows a jump to any of the eight stages with no ordering enforced', async () => {
    const fakes = fakesWithPlant();
    const transitionPlantLifecycleStage = new TransitionPlantLifecycleStage(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await transitionPlantLifecycleStage.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      'ready_to_harvest',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(result.lifecycleStage).toBe('ready_to_harvest');
  });

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithPlant();
    const transitionPlantLifecycleStage = new TransitionPlantLifecycleStage(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      transitionPlantLifecycleStage.execute(
        PLANT_ID,
        PROFILE_ID,
        999,
        'flowering',
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });
});
