import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { registerMediaRecord } from '../../media/public.js';
import { AddPlantFromPhoto } from './add-plant-from-photo.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-21T09:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithMedia() {
  const fakes = createPlantsInventoryFakes();
  fakes.media.records.set(
    MEDIA_ID,
    registerMediaRecord(
      MEDIA_ID,
      GARDEN_ID,
      PROFILE_ID,
      'garden_photo',
      'photo.jpg',
      'image/jpeg',
      123_456,
      null,
      null,
      null,
      null,
      NOW,
    ),
  );
  return fakes;
}

describe('AddPlantFromPhoto', () => {
  it('creates a plant, one plant_photo, and one plant_identification row, with taxonomyReferenceId staying null', async () => {
    const fakes = fakesWithMedia();
    const addPlantFromPhoto = new AddPlantFromPhoto(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await addPlantFromPhoto.execute(
      GARDEN_ID,
      PROFILE_ID,
      { photoMediaId: MEDIA_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.taxonomyReferenceId).toBeNull();
    expect(result.groupingKind).toBe('individual');
    expect(fakes.plants.plants.size).toBe(1);
    expect(fakes.plantPhotos.photos.size).toBe(1);
    expect(fakes.plantIdentifications.identifications.size).toBe(1);

    const photo = [...fakes.plantPhotos.photos.values()][0];
    expect(photo?.plantId).toBe(result.id);
    expect(photo?.mediaId).toBe(MEDIA_ID);
    expect(photo?.isPrimary).toBe(true);

    const identification = [...fakes.plantIdentifications.identifications.values()][0];
    expect(identification?.plantId).toBe(result.id);
    expect(identification?.plantPhotoId).toBe(photo?.id);
    // Matches the honestly-fake stub in identify-plant-from-photo.ts.
    expect(identification?.suggestedTaxonomyId).toBeNull();
    expect(identification?.confidenceScore).toBe(0);

    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: result.id,
        revision: 1,
        commandType: 'addPlantFromPhoto',
        lifecycleStage: 'planned',
        status: 'active',
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('rejects a photoMediaId that MediaRepository.get does not return', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlantFromPhoto = new AddPlantFromPhoto(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      addPlantFromPhoto.execute(
        GARDEN_ID,
        PROFILE_ID,
        { photoMediaId: MEDIA_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.plants.plants.size).toBe(0);
    expect(fakes.plantPhotos.photos.size).toBe(0);
    expect(fakes.plantIdentifications.identifications.size).toBe(0);
  });
});
