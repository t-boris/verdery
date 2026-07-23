import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { SetPrimaryPlantPhoto } from './set-primary-plant-photo.js';
import {
  authorizationGranting,
  buildPlant,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PHOTO_A = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const PHOTO_B = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const NOW = new Date('2026-07-21T09:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithTwoPhotos() {
  const fakes = createPlantsInventoryFakes();
  fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
  fakes.plantPhotos.photos.set(PHOTO_A, {
    id: PHOTO_A,
    plantId: PLANT_ID,
    mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
    isPrimary: true,
    createdAt: NOW,
  });
  fakes.plantPhotos.photos.set(PHOTO_B, {
    id: PHOTO_B,
    plantId: PLANT_ID,
    mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
    isPrimary: false,
    createdAt: NOW,
  });
  return fakes;
}

describe('SetPrimaryPlantPhoto', () => {
  it('flips is_primary to the given photo and clears it from the previous one', async () => {
    const fakes = fakesWithTwoPhotos();
    const setPrimaryPlantPhoto = new SetPrimaryPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    const result = await setPrimaryPlantPhoto.execute(
      PLANT_ID,
      PROFILE_ID,
      PHOTO_B,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
    );

    expect(result.isPrimary).toBe(true);
    expect(fakes.plantPhotos.photos.get(PHOTO_B)?.isPrimary).toBe(true);
    expect(fakes.plantPhotos.photos.get(PHOTO_A)?.isPrimary).toBe(false);
  });

  it('rejects a plantPhotoId that does not exist for this plant', async () => {
    const fakes = fakesWithTwoPhotos();
    const setPrimaryPlantPhoto = new SetPrimaryPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    await expect(
      setPrimaryPlantPhoto.execute(
        PLANT_ID,
        PROFILE_ID,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a photo belonging to a different plant', async () => {
    const fakes = fakesWithTwoPhotos();
    const otherPlantId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a15';
    fakes.plants.plants.set(otherPlantId, buildPlant({ id: otherPlantId, gardenId: GARDEN_ID }));
    const setPrimaryPlantPhoto = new SetPrimaryPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    await expect(
      setPrimaryPlantPhoto.execute(
        otherPlantId,
        PROFILE_ID,
        PHOTO_A,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a16',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
