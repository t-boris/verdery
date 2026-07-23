import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { MembershipRepository } from '../../gardens-mapping/public.js';
import { createObservation } from '../domain/observation.js';
import { ListObservationsForPlant } from './list-observations-for-plant.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';

const GARDEN_ID = randomUUID();
const PLANT_ID = randomUUID();
const PROFILE_ID = randomUUID();

class FakeMembershipRepository implements MembershipRepository {
  findActiveMembership() {
    return Promise.resolve({
      id: randomUUID(),
      gardenId: GARDEN_ID,
      profileId: PROFILE_ID,
      role: 'viewer' as const,
    });
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): Promise<never[]> {
    throw new Error('not used by this test');
  }
}

class FakeObservationRepository implements ObservationRepository {
  public lastPlantQuery: { gardenId: string; plantId: string } | null = null;

  constructor(private readonly entries: ObservationHistoryEntry[]) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  get(): Promise<null> {
    throw new Error('not used by this test');
  }

  listForGarden(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }

  listForPlant(gardenId: string, plantId: string): Promise<ObservationHistoryEntry[]> {
    this.lastPlantQuery = { gardenId, plantId };
    return Promise.resolve(this.entries);
  }

  getWithHistory(): Promise<ObservationHistoryEntry | null> {
    throw new Error('not used by this test');
  }
}

describe('ListObservationsForPlant', () => {
  it('scopes the repository query by both gardenId and plantId and returns the mapped resources', async () => {
    const entry: ObservationHistoryEntry = {
      observation: createObservation({
        id: randomUUID(),
        gardenId: GARDEN_ID,
        plantId: PLANT_ID,
        gardenObjectId: null,
        actorProfileId: PROFILE_ID,
        rawNoteText: 'Note',
        rawConditionSummary: null,
        observedAt: new Date('2026-07-21T09:00:00Z'),
        photoCount: 0,
        now: new Date('2026-07-21T09:00:00Z'),
      }),
      isCorrected: true,
      photos: [],
    };
    const observations = new FakeObservationRepository([entry]);
    const listObservationsForPlant = new ListObservationsForPlant(
      observations,
      new GardenAuthorization(new FakeMembershipRepository()),
    );

    const resources = await listObservationsForPlant.execute(GARDEN_ID, PLANT_ID, PROFILE_ID);

    expect(observations.lastPlantQuery).toEqual({ gardenId: GARDEN_ID, plantId: PLANT_ID });
    expect(resources).toEqual([
      expect.objectContaining({ id: entry.observation.id, isCorrected: true }),
    ]);
  });
});
