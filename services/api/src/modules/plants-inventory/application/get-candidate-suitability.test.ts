import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { GetCandidateSuitability } from './get-candidate-suitability.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
} from './plants-inventory-test-doubles.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

describe('GetCandidateSuitability', () => {
  it('returns the latest assessment when one exists', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      CANDIDATE_ID,
      buildCandidate({ id: CANDIDATE_ID, gardenId: GARDEN_ID }),
    );
    const assessments = new (class {
      insert = () => Promise.resolve();
      findLatest = () =>
        Promise.resolve({
          candidateId: CANDIDATE_ID,
          findings: [
            {
              category: 'unknown' as const,
              axis: 'sun_exposure' as const,
              reason: 'garden_context_missing' as const,
            },
          ],
        });
    })();
    const getSuitability = new GetCandidateSuitability(
      fakes.candidates,
      assessments,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    const result = await getSuitability.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID);
    expect(result.candidateId).toBe(CANDIDATE_ID);
  });

  it('reports not found when no assessment has ever run', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      CANDIDATE_ID,
      buildCandidate({ id: CANDIDATE_ID, gardenId: GARDEN_ID }),
    );
    const assessments = new (class {
      insert = () => Promise.resolve();
      findLatest = () => Promise.resolve(null);
    })();
    const getSuitability = new GetCandidateSuitability(
      fakes.candidates,
      assessments,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    await expect(
      getSuitability.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
