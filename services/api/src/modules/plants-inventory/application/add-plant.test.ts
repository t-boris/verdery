import { describe, expect, it } from 'vitest';
import { ForbiddenError, ValidationError } from '../../../platform/errors/application-error.js';
import type { MapObjectSummary } from '../../gardens-mapping/public.js';
import { AddPlant } from './add-plant.js';
import {
  authorizationDenying,
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const MAP_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-21T09:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function activeMapObjectSummary(): MapObjectSummary {
  return {
    id: MAP_OBJECT_ID,
    gardenId: GARDEN_ID,
    category: 'bed',
    lifecycleState: 'active',
    currentRevision: 1,
  };
}

describe('AddPlant', () => {
  it('creates a plant, journals it, and returns a resource, not a raw entity', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await addPlant.execute(
      GARDEN_ID,
      PROFILE_ID,
      { displayName: '  Tomato  ', groupingKind: 'individual' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result).toMatchObject({
      gardenId: GARDEN_ID,
      displayName: 'Tomato',
      groupingKind: 'individual',
      lifecycleStage: 'planned',
      status: 'active',
      revision: 1,
    });
    expect(fakes.plants.plants.size).toBe(1);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: result.id,
        revision: 1,
        commandType: 'addPlant',
        lifecycleStage: 'planned',
        status: 'active',
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('accepts a placement referencing an active map object in this garden', async () => {
    const fakes = createPlantsInventoryFakes(new Map([[MAP_OBJECT_ID, activeMapObjectSummary()]]));
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await addPlant.execute(
      GARDEN_ID,
      PROFILE_ID,
      { displayName: 'Tomato', groupingKind: 'individual', gardenAreaMapObjectId: MAP_OBJECT_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(result.gardenAreaMapObjectId).toBe(MAP_OBJECT_ID);
  });

  it('rejects a placement referencing a map object that does not exist', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      addPlant.execute(
        GARDEN_ID,
        PROFILE_ID,
        { displayName: 'Tomato', groupingKind: 'individual', gardenAreaMapObjectId: MAP_OBJECT_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.plants.plants.size).toBe(0);
  });

  it('rejects quantity/groupingKind invariant violations without inserting anything', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      addPlant.execute(
        GARDEN_ID,
        PROFILE_ID,
        { displayName: 'Carrots', groupingKind: 'row' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.plants.plants.size).toBe(0);
  });

  it('rejects a caller lacking editGardenContent before doing any work', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting({ ...OWNER_MEMBERSHIP, role: 'viewer' }),
      fixedClock(NOW),
    );

    await expect(
      addPlant.execute(
        GARDEN_ID,
        PROFILE_ID,
        { displayName: 'Tomato', groupingKind: 'individual' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fakes.plants.plants.size).toBe(0);
  });

  it('conceals a garden the caller has no membership on as notFound', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationDenying(),
      fixedClock(NOW),
    );

    await expect(
      addPlant.execute(
        GARDEN_ID,
        PROFILE_ID,
        { displayName: 'Tomato', groupingKind: 'individual' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
      ),
    ).rejects.toThrow();
  });

  it('replays the same idempotency key without creating a second plant', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlant = new AddPlant(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14';

    const first = await addPlant.execute(
      GARDEN_ID,
      PROFILE_ID,
      { displayName: 'Tomato', groupingKind: 'individual' },
      key,
    );
    const replay = await addPlant.execute(
      GARDEN_ID,
      PROFILE_ID,
      { displayName: 'Tomato', groupingKind: 'individual' },
      key,
    );

    expect(replay).toEqual(first);
    expect(fakes.plants.plants.size).toBe(1);
  });
});
