import { describe, expect, it } from 'vitest';
import { StaleRevisionError, ValidationError } from '../../../platform/errors/application-error.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';
import { UpdateCandidateDetails } from './update-candidate-details.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-29T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithCandidate() {
  const fakes = createPlantsInventoryFakes();
  fakes.candidates.candidates.set(
    CANDIDATE_ID,
    buildCandidate({ id: CANDIDATE_ID, gardenId: GARDEN_ID }),
  );
  return fakes;
}

describe('UpdateCandidateDetails', () => {
  it('applies the named changes and bumps the revision', async () => {
    const fakes = fakesWithCandidate();
    const updateCandidateDetails = new UpdateCandidateDetails(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await updateCandidateDetails.execute(
      CANDIDATE_ID,
      PROFILE_ID,
      1,
      { displayName: 'Definitely a fig tree', priority: 'high' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.displayName).toBe('Definitely a fig tree');
    expect(result.priority).toBe('high');
    expect(result.revision).toBe(2);
  });

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithCandidate();
    const updateCandidateDetails = new UpdateCandidateDetails(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      updateCandidateDetails.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        999,
        { displayName: 'Renamed' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('rejects an unpaired purchase price change', async () => {
    const fakes = fakesWithCandidate();
    const updateCandidateDetails = new UpdateCandidateDetails(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      updateCandidateDetails.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        1,
        { priceAmount: 20 },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('replays the same idempotency key without a second revision bump', async () => {
    const fakes = fakesWithCandidate();
    const updateCandidateDetails = new UpdateCandidateDetails(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';

    const first = await updateCandidateDetails.execute(
      CANDIDATE_ID,
      PROFILE_ID,
      1,
      { displayName: 'Renamed' },
      key,
    );
    const replay = await updateCandidateDetails.execute(
      CANDIDATE_ID,
      PROFILE_ID,
      1,
      { displayName: 'Renamed' },
      key,
    );

    expect(replay).toEqual(first);
    expect(fakes.candidates.candidates.get(CANDIDATE_ID)?.revision).toBe(2);
  });
});
