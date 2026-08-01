import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import { DeleteCandidate } from './delete-candidate.js';
import type { PlantCandidate } from '../domain/plant-candidate.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0b';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0c';
const OTHER_CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0e';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0d';
const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b10';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b11';
const ASSESSMENT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b12';

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function idempotencyKey(suffix: string): string {
  return `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b${suffix}`;
}

function fakesWithCandidate(overrides: Partial<PlantCandidate> = {}) {
  const fakes = createPlantsInventoryFakes();
  fakes.candidates.candidates.set(
    CANDIDATE_ID,
    buildCandidate({ ...overrides, id: CANDIDATE_ID, gardenId: GARDEN_ID }),
  );
  return fakes;
}

function buildUseCase(fakes: ReturnType<typeof createPlantsInventoryFakes>) {
  return new DeleteCandidate(
    fakes.candidates,
    fakes.idempotency,
    new FakePlantsInventoryUnitOfWork(fakes),
    authorizationGranting(OWNER_MEMBERSHIP),
  );
}

describe('DeleteCandidate', () => {
  it('removes the candidate row', async () => {
    const fakes = fakesWithCandidate();

    await buildUseCase(fakes).execute(CANDIDATE_ID, PROFILE_ID, 1, idempotencyKey('20'));

    expect(fakes.candidates.candidates.has(CANDIDATE_ID)).toBe(false);
  });

  // The dependent rows are the whole reason this is a use case rather than a
  // one-line repository call: leaving any of them behind is a foreign-key
  // violation at best and an orphan at worst.
  it('takes its suitability assessments and photo links with it', async () => {
    const fakes = fakesWithCandidate();
    await fakes.candidatePhotos.insert({
      id: PHOTO_ID,
      candidateId: CANDIDATE_ID,
      mediaId: MEDIA_ID,
      isPrimary: true,
      createdAt: new Date('2026-07-29T10:00:00Z'),
    });
    await fakes.candidateSuitability.insert(ASSESSMENT_ID, {
      candidateId: CANDIDATE_ID,
      findings: [],
    });

    await buildUseCase(fakes).execute(CANDIDATE_ID, PROFILE_ID, 1, idempotencyKey('21'));

    expect(await fakes.candidatePhotos.findAllForCandidate(CANDIDATE_ID)).toEqual([]);
    expect(await fakes.candidateSuitability.findLatest(CANDIDATE_ID)).toBeNull();
  });

  // A sibling candidate naming this one as its alternative is a dependency
  // exactly like a photo link — the difference is only that it survives.
  it('clears the alternative reference from a sibling candidate rather than deleting it', async () => {
    const fakes = fakesWithCandidate();
    fakes.candidates.candidates.set(
      OTHER_CANDIDATE_ID,
      buildCandidate({
        id: OTHER_CANDIDATE_ID,
        gardenId: GARDEN_ID,
        alternativeToCandidateId: CANDIDATE_ID,
      }),
    );

    await buildUseCase(fakes).execute(CANDIDATE_ID, PROFILE_ID, 1, idempotencyKey('22'));

    const sibling = fakes.candidates.candidates.get(OTHER_CANDIDATE_ID);
    expect(sibling).toBeDefined();
    expect(sibling?.alternativeToCandidateId).toBeNull();
  });

  // Deleting it would leave a plant whose origin cannot be explained, which is
  // exactly what FR-19's "conversion must preserve the decision history" forbids.
  it('refuses a converted candidate', async () => {
    const fakes = fakesWithCandidate({ status: 'converted' });

    await expect(
      buildUseCase(fakes).execute(CANDIDATE_ID, PROFILE_ID, 1, idempotencyKey('23')),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    expect(fakes.candidates.candidates.has(CANDIDATE_ID)).toBe(true);
  });

  it('rejects a stale expectedRevision and leaves the candidate in place', async () => {
    const fakes = fakesWithCandidate();

    await expect(
      buildUseCase(fakes).execute(CANDIDATE_ID, PROFILE_ID, 99, idempotencyKey('24')),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    expect(fakes.candidates.candidates.has(CANDIDATE_ID)).toBe(true);
  });
});
