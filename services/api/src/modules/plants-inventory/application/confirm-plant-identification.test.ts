import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import { ConfirmPlantIdentification } from './confirm-plant-identification.js';
import {
  authorizationGranting,
  buildPlant,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const OTHER_PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const IDENTIFICATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithPlantAndIdentification() {
  const fakes = createPlantsInventoryFakes();
  fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
  fakes.plantIdentifications.identifications.set(IDENTIFICATION_ID, {
    id: IDENTIFICATION_ID,
    plantId: PLANT_ID,
    plantPhotoId: PHOTO_ID,
    suggestedTaxonomyId: TAXONOMY_ID,
    confidenceScore: 0.8,
    createdAt: NOW,
  });
  return fakes;
}

describe('ConfirmPlantIdentification', () => {
  it('sets taxonomyReferenceId and acceptedIdentificationId from the identification row', async () => {
    const fakes = fakesWithPlantAndIdentification();
    const confirmPlantIdentification = new ConfirmPlantIdentification(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await confirmPlantIdentification.execute(
      PLANT_ID,
      PROFILE_ID,
      IDENTIFICATION_ID,
      1,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
    );

    expect(result.taxonomyReferenceId).toBe(TAXONOMY_ID);
    expect(result.acceptedIdentificationId).toBe(IDENTIFICATION_ID);
    expect(result.revision).toBe(2);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: PLANT_ID,
        revision: 2,
        commandType: 'confirmIdentification',
        lifecycleStage: null,
        status: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('rejects an identificationId that does not exist', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.plants.plants.set(PLANT_ID, buildPlant({ id: PLANT_ID, gardenId: GARDEN_ID }));
    const confirmPlantIdentification = new ConfirmPlantIdentification(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      confirmPlantIdentification.execute(
        PLANT_ID,
        PROFILE_ID,
        IDENTIFICATION_ID,
        1,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an identification that belongs to a different plant with a typed mismatch error', async () => {
    const fakes = fakesWithPlantAndIdentification();
    fakes.plants.plants.set(
      OTHER_PLANT_ID,
      buildPlant({ id: OTHER_PLANT_ID, gardenId: GARDEN_ID }),
    );
    const confirmPlantIdentification = new ConfirmPlantIdentification(
      fakes.plants,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      confirmPlantIdentification.execute(
        OTHER_PLANT_ID,
        PROFILE_ID,
        IDENTIFICATION_ID,
        1,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14',
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });
});
