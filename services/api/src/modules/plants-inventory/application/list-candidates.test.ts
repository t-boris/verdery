import { describe, expect, it } from 'vitest';
import { ListCandidates } from './list-candidates.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
} from './plants-inventory-test-doubles.js';
import { buildCandidate } from './plant-candidate-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

describe('ListCandidates', () => {
  it('lists only this garden’s candidates, filtered by status', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      'a',
      buildCandidate({ id: 'a', gardenId: GARDEN_ID, status: 'active' }),
    );
    fakes.candidates.candidates.set(
      'b',
      buildCandidate({ id: 'b', gardenId: GARDEN_ID, status: 'archived' }),
    );
    fakes.candidates.candidates.set(
      'c',
      buildCandidate({ id: 'c', gardenId: 'other-garden', status: 'active' }),
    );
    const listCandidates = new ListCandidates(
      fakes.candidates,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    const result = await listCandidates.execute(
      GARDEN_ID,
      PROFILE_ID,
      { status: ['active'] },
      null,
      50,
    );

    expect(result.items.map((item) => item.id)).toEqual(['a']);
    expect(result.nextCursor).toBeNull();
  });

  it('matches a text query against displayName', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      'a',
      buildCandidate({ id: 'a', gardenId: GARDEN_ID, displayName: 'Fig sapling' }),
    );
    fakes.candidates.candidates.set(
      'b',
      buildCandidate({ id: 'b', gardenId: GARDEN_ID, displayName: 'Tomato seedling' }),
    );
    const listCandidates = new ListCandidates(
      fakes.candidates,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    const result = await listCandidates.execute(GARDEN_ID, PROFILE_ID, { query: 'fig' }, null, 50);

    expect(result.items.map((item) => item.id)).toEqual(['a']);
  });

  it('filters by priority', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      'a',
      buildCandidate({ id: 'a', gardenId: GARDEN_ID, priority: 'high' }),
    );
    fakes.candidates.candidates.set(
      'b',
      buildCandidate({ id: 'b', gardenId: GARDEN_ID, priority: 'low' }),
    );
    const listCandidates = new ListCandidates(
      fakes.candidates,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    const result = await listCandidates.execute(
      GARDEN_ID,
      PROFILE_ID,
      { priority: ['high'] },
      null,
      50,
    );

    expect(result.items.map((item) => item.id)).toEqual(['a']);
  });

  it('filters by identified state', async () => {
    const fakes = createPlantsInventoryFakes();
    fakes.candidates.candidates.set(
      'a',
      buildCandidate({
        id: 'a',
        gardenId: GARDEN_ID,
        taxonomyReferenceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      }),
    );
    fakes.candidates.candidates.set(
      'b',
      buildCandidate({ id: 'b', gardenId: GARDEN_ID, taxonomyReferenceId: null }),
    );
    const listCandidates = new ListCandidates(
      fakes.candidates,
      authorizationGranting(OWNER_MEMBERSHIP),
    );

    const identified = await listCandidates.execute(
      GARDEN_ID,
      PROFILE_ID,
      { identified: true },
      null,
      50,
    );
    expect(identified.items.map((item) => item.id)).toEqual(['a']);

    const unidentified = await listCandidates.execute(
      GARDEN_ID,
      PROFILE_ID,
      { identified: false },
      null,
      50,
    );
    expect(unidentified.items.map((item) => item.id)).toEqual(['b']);
  });
});
