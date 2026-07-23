import { describe, expect, it } from 'vitest';
import { StaleRevisionError } from '../../../platform/errors/application-error.js';
import { SetPlantStatus } from './set-plant-status.js';
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

describe('SetPlantStatus', () => {
  it('sets the new status, bumps the revision, and journals status only', async () => {
    const fakes = fakesWithPlant();
    const setPlantStatus = new SetPlantStatus(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await setPlantStatus.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      'removed',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.status).toBe('removed');
    expect(result.lifecycleStage).toBe('planned');
    expect(result.revision).toBe(2);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: PLANT_ID,
        revision: 2,
        commandType: 'setStatus',
        lifecycleStage: null,
        status: 'removed',
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('models "delete" as a status transition to removed, not a hard delete', async () => {
    const fakes = fakesWithPlant();
    const setPlantStatus = new SetPlantStatus(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await setPlantStatus.execute(
      PLANT_ID,
      PROFILE_ID,
      1,
      'removed',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(fakes.plants.plants.has(PLANT_ID)).toBe(true);
    // The sync-change entry mirrors that: an 'upsert' at the plant's new
    // revision, never a 'delete' tombstone — a puller must still be able to
    // read this plant's 'removed' status back, which a tombstone would
    // prevent.
    expect(fakes.syncChanges.entries).toEqual([
      {
        gardenId: GARDEN_ID,
        recordId: PLANT_ID,
        recordType: 'plant',
        operation: 'upsert',
        recordRevision: result.revision,
      },
    ]);
  });

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithPlant();
    const setPlantStatus = new SetPlantStatus(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      setPlantStatus.execute(
        PLANT_ID,
        PROFILE_ID,
        999,
        'dead',
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });
});
