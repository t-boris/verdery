import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GardenRole, MembershipRepository } from '../../gardens-mapping/public.js';
import { createObservation } from '../domain/observation.js';
import { ListObservationsForGarden } from './list-observations-for-garden.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';

const GARDEN_ID = randomUUID();
const PROFILE_ID = randomUUID();

class FakeMembershipRepository implements MembershipRepository {
  constructor(private readonly role: GardenRole | null) {}

  findActiveMembership() {
    if (this.role === null) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: randomUUID(),
      gardenId: GARDEN_ID,
      profileId: PROFILE_ID,
      role: this.role,
    });
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }
}

class FakeObservationRepository implements ObservationRepository {
  constructor(private readonly entries: ObservationHistoryEntry[]) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  get(): Promise<null> {
    throw new Error('not used by this test');
  }

  listForGarden(): Promise<ObservationHistoryEntry[]> {
    return Promise.resolve(this.entries);
  }

  listForPlant(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }
}

function entryFor(observedAt: Date): ObservationHistoryEntry {
  return {
    observation: createObservation({
      id: randomUUID(),
      gardenId: GARDEN_ID,
      plantId: null,
      gardenObjectId: null,
      actorProfileId: PROFILE_ID,
      rawNoteText: 'Note',
      rawConditionSummary: null,
      observedAt,
      photoCount: 0,
      now: observedAt,
    }),
    isCorrected: false,
    photos: [],
  };
}

describe('ListObservationsForGarden', () => {
  it('returns the garden observation history as resources, in the order the repository provides', async () => {
    const entries = [
      entryFor(new Date('2026-07-21T09:00:00Z')),
      entryFor(new Date('2026-07-20T09:00:00Z')),
    ];
    const listObservationsForGarden = new ListObservationsForGarden(
      new FakeObservationRepository(entries),
      new GardenAuthorization(new FakeMembershipRepository('viewer')),
    );

    const resources = await listObservationsForGarden.execute(GARDEN_ID, PROFILE_ID);

    expect(resources).toHaveLength(2);
    expect(resources[0]?.id).toBe(entries[0]?.observation.id);
    expect(resources[1]?.id).toBe(entries[1]?.observation.id);
  });

  it('conceals a garden the caller has no membership on as notFound, without calling the repository', async () => {
    const listObservationsForGarden = new ListObservationsForGarden(
      new FakeObservationRepository([]),
      new GardenAuthorization(new FakeMembershipRepository(null)),
    );

    await expect(listObservationsForGarden.execute(GARDEN_ID, PROFILE_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("allows a viewer, the least-privileged role, since viewGarden is every role's capability", async () => {
    const listObservationsForGarden = new ListObservationsForGarden(
      new FakeObservationRepository([]),
      new GardenAuthorization(new FakeMembershipRepository('viewer')),
    );

    await expect(listObservationsForGarden.execute(GARDEN_ID, PROFILE_ID)).resolves.toEqual([]);
  });
});
