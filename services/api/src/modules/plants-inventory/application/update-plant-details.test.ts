import { describe, expect, it } from 'vitest';
import { StaleRevisionError, ValidationError } from '../../../platform/errors/application-error.js';
import { UpdatePlantDetails } from './update-plant-details.js';
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
const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithPlant() {
  const fakes = createPlantsInventoryFakes();
  fakes.plants.plants.set(
    PLANT_ID,
    buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID, taxonomyReferenceId: TAXONOMY_ID }),
  );
  return fakes;
}

describe('UpdatePlantDetails', () => {
  it('applies the changes, bumps the revision, and journals with no lifecycleStage/status', async () => {
    const fakes = fakesWithPlant();
    const updatePlantDetails = new UpdatePlantDetails(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await updatePlantDetails.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      { displayName: 'Roma Tomato', conditionNote: 'Thriving' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(result).toMatchObject({
      displayName: 'Roma Tomato',
      conditionNote: 'Thriving',
      revision: 2,
    });
    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: PLANT_ID,
        revision: 2,
        commandType: 'updateDetails',
        lifecycleStage: null,
        status: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('setting taxonomyReferenceId to null is always legal', async () => {
    const fakes = fakesWithPlant();
    const updatePlantDetails = new UpdatePlantDetails(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await updatePlantDetails.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      { taxonomyReferenceId: null },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
    );

    expect(result.taxonomyReferenceId).toBeNull();
  });

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithPlant();
    const updatePlantDetails = new UpdatePlantDetails(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      updatePlantDetails.execute(
        PLANT_ID,
        PROFILE_ID,
        999,
        { displayName: 'Roma Tomato' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("rejects a quantity invariant violation against the plant's own groupingKind", async () => {
    const fakes = fakesWithPlant();
    const updatePlantDetails = new UpdatePlantDetails(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      updatePlantDetails.execute(
        PLANT_ID,
        PROFILE_ID,
        1,
        { quantity: 5 },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
