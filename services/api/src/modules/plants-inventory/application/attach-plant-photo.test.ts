import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../../platform/errors/application-error.js';
import { AttachPlantPhoto } from './attach-plant-photo.js';
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
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NOW = new Date('2026-07-21T09:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithPlantAndMedia() {
  const fakes = createPlantsInventoryFakes();
  fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
  fakes.media.records.set(MEDIA_ID, {
    id: MEDIA_ID,
    storageReference: 'gs://verdery-media/example.jpg',
    mimeType: 'image/jpeg',
    uploadedByProfileId: PROFILE_ID,
    createdAt: NOW,
  });
  return fakes;
}

describe('AttachPlantPhoto', () => {
  it('appends a plant_photo row and returns a photo resource, leaving plant untouched', async () => {
    const fakes = fakesWithPlantAndMedia();
    const attachPlantPhoto = new AttachPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await attachPlantPhoto.execute(
      PLANT_ID,
      PROFILE_ID,
      { mediaId: MEDIA_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(result).toMatchObject({ plantId: PLANT_ID, mediaId: MEDIA_ID, isPrimary: false });
    expect(fakes.plantPhotos.photos.size).toBe(1);
    expect(fakes.plants.plants.get(PLANT_ID)?.revision).toBe(1);
    expect(fakes.revisionJournal.entries).toHaveLength(0);
    // Not touching `plant.revision` does not mean sync stays silent: a
    // sync_change row still records the plant at its own (unbumped)
    // revision, so a puller learns a new photo exists on it.
    expect(fakes.syncChanges.entries).toEqual([
      {
        gardenId: GARDEN_ID,
        recordId: PLANT_ID,
        recordType: 'plant',
        operation: 'upsert',
        recordRevision: 1,
      },
    ]);
  });

  it('clears any existing primary before setting isPrimary: true', async () => {
    const fakes = fakesWithPlantAndMedia();
    const existingPrimaryId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
    fakes.plantPhotos.photos.set(existingPrimaryId, {
      id: existingPrimaryId,
      plantId: PLANT_ID,
      mediaId: MEDIA_ID,
      isPrimary: true,
      createdAt: NOW,
    });
    const attachPlantPhoto = new AttachPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await attachPlantPhoto.execute(
      PLANT_ID,
      PROFILE_ID,
      { mediaId: MEDIA_ID, isPrimary: true },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
    );

    expect(result.isPrimary).toBe(true);
    expect(fakes.plantPhotos.photos.get(existingPrimaryId)?.isPrimary).toBe(false);
  });

  it('rejects a mediaId that MediaRepository.get does not return', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
    const attachPlantPhoto = new AttachPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      attachPlantPhoto.execute(
        PLANT_ID,
        PROFILE_ID,
        { mediaId: MEDIA_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.plantPhotos.photos.size).toBe(0);
  });

  it('rejects a plantId that does not exist', async () => {
    const fakes = createPlantsInventoryFakes();
    const attachPlantPhoto = new AttachPlantPhoto(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      attachPlantPhoto.execute(
        PLANT_ID,
        PROFILE_ID,
        { mediaId: MEDIA_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
