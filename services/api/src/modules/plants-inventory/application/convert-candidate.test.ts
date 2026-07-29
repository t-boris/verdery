import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import type { MapObjectSummary } from '../../gardens-mapping/public.js';
import { ConvertCandidate } from './convert-candidate.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const MAP_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NOW = new Date('2026-07-29T11:00:00Z');

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

function fakesWithCandidate(overrides: Partial<Parameters<typeof buildCandidate>[0]> = {}) {
  const fakes = createPlantsInventoryFakes(new Map([[MAP_OBJECT_ID, activeMapObjectSummary()]]));
  fakes.candidates.candidates.set(
    CANDIDATE_ID,
    buildCandidate({
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      displayName: 'Fig tree',
      proposedGardenAreaMapObjectId: MAP_OBJECT_ID,
      ...overrides,
    }),
  );
  return fakes;
}

describe('ConvertCandidate', () => {
  it('creates a plant from the candidate, marks it converted, and records the conversion', async () => {
    const fakes = fakesWithCandidate();
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await convertCandidate.execute(
      CANDIDATE_ID,
      PROFILE_ID,
      1,
      { acquisitionDate: '2026-07-29', acquisitionDateType: 'planted' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(result.plant).toMatchObject({
      gardenId: GARDEN_ID,
      displayName: 'Fig tree',
      gardenAreaMapObjectId: MAP_OBJECT_ID,
      acquisitionDate: '2026-07-29',
      acquisitionDateType: 'planted',
      revision: 1,
    });
    expect(result.candidate.status).toBe('converted');
    expect(result.candidate.revision).toBe(2);
    expect(result.conversion).toMatchObject({
      candidateId: CANDIDATE_ID,
      plantId: result.plant.id,
      convertedByProfileId: PROFILE_ID,
    });
    expect(fakes.plants.plants.size).toBe(1);
    expect(fakes.candidateConversions.conversions.get(CANDIDATE_ID)).toBeDefined();
    expect(fakes.revisionJournal.entries).toEqual([
      expect.objectContaining({ plantId: result.plant.id, commandType: 'convertCandidate' }),
    ]);
  });

  it('defaults to the proposed placement when no override is given', async () => {
    const fakes = fakesWithCandidate();
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await convertCandidate.execute(
      CANDIDATE_ID,
      PROFILE_ID,
      1,
      {},
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
    );

    expect(result.plant.gardenAreaMapObjectId).toBe(MAP_OBJECT_ID);
  });

  it('refuses to convert an already-converted candidate', async () => {
    const fakes = fakesWithCandidate({ status: 'converted' });
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      convertCandidate.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        1,
        {},
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    expect(fakes.plants.plants.size).toBe(0);
  });

  it('refuses to convert an archived candidate', async () => {
    const fakes = fakesWithCandidate({ status: 'archived' });
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      convertCandidate.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        1,
        {},
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    expect(fakes.plants.plants.size).toBe(0);
  });

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithCandidate();
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      convertCandidate.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        999,
        {},
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    expect(fakes.plants.plants.size).toBe(0);
  });

  it('replays the same idempotency key without creating a second plant or conversion', async () => {
    const fakes = fakesWithCandidate();
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14';

    const first = await convertCandidate.execute(CANDIDATE_ID, PROFILE_ID, 1, {}, key);
    const replay = await convertCandidate.execute(CANDIDATE_ID, PROFILE_ID, 1, {}, key);

    expect(replay).toEqual(first);
    expect(fakes.plants.plants.size).toBe(1);
  });

  it('translates a candidate_conversion unique-violation race into a clean, typed error', async () => {
    // Manufactures the race directly: a conversion row already exists for
    // this candidate even though its own `status` still reads 'active' — a
    // state two real concurrent transactions could momentarily produce
    // before either commits, and not reproducible through the
    // (non-transactional, sequential) fakes any other way. This exercises
    // `ConvertCandidate`'s own translation of the unique-violation, not the
    // ordinary revision-guard path the tests above already cover.
    const fakes = fakesWithCandidate();
    fakes.candidateConversions.conversions.set(CANDIDATE_ID, {
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a15',
      candidateId: CANDIDATE_ID,
      plantId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a16',
      convertedByProfileId: PROFILE_ID,
      convertedAt: NOW,
    });
    const convertCandidate = new ConvertCandidate(
      fakes.candidates,
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      convertCandidate.execute(
        CANDIDATE_ID,
        PROFILE_ID,
        1,
        {},
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a17',
      ),
    ).rejects.toMatchObject({
      code: 'plants_inventory.plant_candidate.already_converted',
    });
  });
});
