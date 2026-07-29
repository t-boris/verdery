import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { GetCandidate } from './get-candidate.js';
import {
  authorizationDenying,
  authorizationGranting,
  createPlantsInventoryFakes,
} from './plants-inventory-test-doubles.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

describe('GetCandidate', () => {
  it('returns the candidate resource for a viewer', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      CANDIDATE_ID,
      buildCandidate({ id: CANDIDATE_ID, gardenId: GARDEN_ID }),
    );
    const getCandidate = new GetCandidate(
      fakes.candidates,
      authorizationGranting({ ...OWNER_MEMBERSHIP, role: 'viewer' }),
    );

    const result = await getCandidate.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID);
    expect(result.id).toBe(CANDIDATE_ID);
  });

  it('conceals a candidate in a different garden as not found', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      CANDIDATE_ID,
      buildCandidate({ id: CANDIDATE_ID, gardenId: OTHER_GARDEN_ID }),
    );
    const getCandidate = new GetCandidate(
      fakes.candidates,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    await expect(getCandidate.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('conceals a garden the caller has no membership on as not found', async () => {
    const fakes = createPlantsInventoryFakes();
    const getCandidate = new GetCandidate(fakes.candidates, authorizationDenying());

    await expect(getCandidate.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID)).rejects.toThrow();
  });
});
