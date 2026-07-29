import { describe, expect, it } from 'vitest';
import { StaleRevisionError } from '../../../platform/errors/application-error.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';
import { SetCandidateStatus } from './set-candidate-status.js';

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

describe('SetCandidateStatus', () => {
  it.each(['archived', 'rejected'] as const)(
    'transitions to %s, bumping revision',
    async (target) => {
      const fakes = fakesWithCandidate();
      const setCandidateStatus = new SetCandidateStatus(
        fakes.candidates,
        fakes.idempotency,
        new FakePlantsInventoryUnitOfWork(fakes),
        authorizationGranting(OWNER_MEMBERSHIP),
        fixedClock(NOW),
      );

      const result = await setCandidateStatus.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        1,
        target,
        `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a${target === 'archived' ? '0e' : '0f'}`,
      );

      expect(result.status).toBe(target);
      expect(result.revision).toBe(2);
    },
  );

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithCandidate();
    const setCandidateStatus = new SetCandidateStatus(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      setCandidateStatus.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        999,
        'archived',
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });
});
