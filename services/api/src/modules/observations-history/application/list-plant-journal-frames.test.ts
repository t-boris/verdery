import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { MembershipRepository } from '../../gardens-mapping/public.js';
import { ListPlantJournalFrames } from './list-plant-journal-frames.js';
import type {
  ObservationPhotoRepository,
  PlantJournalFrame,
} from './observation-photo-repository.js';

const GARDEN_ID = randomUUID();
const PLANT_ID = randomUUID();
const PROFILE_ID = randomUUID();
const OBSERVATION_ID = randomUUID();
const MEDIA_ID = randomUUID();

/** A viewer: the least role `viewGarden` accepts, which is what this read requires. */
class FakeMembershipRepository implements MembershipRepository {
  findGardenAccess() {
    return Promise.resolve({
      membership: {
        id: randomUUID(),
        gardenId: GARDEN_ID,
        profileId: PROFILE_ID,
        role: 'viewer' as const,
      },
      gardenLifecycleState: 'active' as const,
    });
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  listForGarden(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  listDetailsForProfile(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  setState(): Promise<void> {
    throw new Error('not used by this test');
  }

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  findActiveByGardenAndProfile(): ReturnType<MembershipRepository['findActiveByGardenAndProfile']> {
    throw new Error('not used by this test');
  }

  listActiveForGarden(): ReturnType<MembershipRepository['listActiveForGarden']> {
    throw new Error('not used by this test');
  }

  lockActiveOwnerIds(): ReturnType<MembershipRepository['lockActiveOwnerIds']> {
    throw new Error('not used by this test');
  }

  lockMembership(): ReturnType<MembershipRepository['lockMembership']> {
    throw new Error('not used by this test');
  }

  changeRole(): Promise<void> {
    throw new Error('not used by this test');
  }

  openPeriod(): Promise<void> {
    throw new Error('not used by this test');
  }

  closeOpenPeriod(): Promise<void> {
    throw new Error('not used by this test');
  }
}

class FakePhotoRepository implements ObservationPhotoRepository {
  public lastQuery: { plantId: string; purpose: string | null; limit: number } | null = null;

  constructor(private readonly frames: readonly PlantJournalFrame[] = []) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  listAnalysisHistoryForPlant(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  listJournalFramesForPlant(
    plantId: string,
    purpose: string | null,
    limit: number,
  ): Promise<readonly PlantJournalFrame[]> {
    this.lastQuery = { plantId, purpose, limit };
    return Promise.resolve(this.frames);
  }
}

function listFrames(photos: ObservationPhotoRepository): ListPlantJournalFrames {
  return new ListPlantJournalFrames(
    photos,
    new GardenAuthorization(new FakeMembershipRepository()),
  );
}

describe('ListPlantJournalFrames', () => {
  it('passes the requested narrowing through and returns the frames as transport shapes', async () => {
    const photos = new FakePhotoRepository([
      {
        observationId: OBSERVATION_ID,
        mediaId: MEDIA_ID,
        observedAt: new Date('2026-04-02T08:00:00Z'),
        purpose: 'whole_plant',
      },
    ]);

    const frames = await listFrames(photos).execute(
      GARDEN_ID,
      PLANT_ID,
      PROFILE_ID,
      'whole_plant',
      50,
    );

    expect(photos.lastQuery).toEqual({ plantId: PLANT_ID, purpose: 'whole_plant', limit: 50 });
    expect(frames).toEqual([
      {
        observationId: OBSERVATION_ID,
        mediaId: MEDIA_ID,
        observedAt: '2026-04-02T08:00:00.000Z',
        purpose: 'whole_plant',
      },
    ]);
  });

  it('caps a limit above the bound instead of trusting the caller', async () => {
    // The route rejects an out-of-range limit, but this use case is also
    // reachable from composition directly, and a sequence is bounded by what
    // a comparison view can use rather than by who asked.
    const photos = new FakePhotoRepository();

    await listFrames(photos).execute(GARDEN_ID, PLANT_ID, PROFILE_ID, null, 10_000);

    expect(photos.lastQuery?.limit).toBe(ListPlantJournalFrames.MAX_FRAMES);
  });

  it('asks for every purpose when none is requested', async () => {
    const photos = new FakePhotoRepository();

    await listFrames(photos).execute(GARDEN_ID, PLANT_ID, PROFILE_ID, null, 20);

    expect(photos.lastQuery?.purpose).toBeNull();
  });
});
