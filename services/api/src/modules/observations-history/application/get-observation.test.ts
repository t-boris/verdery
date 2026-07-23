import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createObservation } from '../domain/observation.js';
import type { Observation } from '../domain/observation.js';
import { GetObservation } from './get-observation.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';

const PROFILE_ID = randomUUID();
const GARDEN_ID = randomUUID();

class FakeObservationRepository implements ObservationRepository {
  constructor(private readonly rows: readonly Observation[]) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  get(id: string): Promise<Observation | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  listForGarden(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }

  listForPlant(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }

  getWithHistory(): Promise<ObservationHistoryEntry | null> {
    throw new Error('not used by this test');
  }
}

describe('GetObservation', () => {
  it('returns the raw domain Observation, not a resource view, for an existing id', async () => {
    const observation = createObservation({
      id: randomUUID(),
      gardenId: GARDEN_ID,
      plantId: null,
      gardenObjectId: null,
      actorProfileId: PROFILE_ID,
      rawNoteText: 'Note',
      rawConditionSummary: null,
      observedAt: new Date('2026-07-21T09:00:00Z'),
      photoCount: 0,
      now: new Date('2026-07-21T09:00:00Z'),
    });
    const getObservation = new GetObservation(new FakeObservationRepository([observation]));

    await expect(getObservation.execute(observation.id)).resolves.toEqual(observation);
  });

  it('returns null for an id that does not exist', async () => {
    const getObservation = new GetObservation(new FakeObservationRepository([]));

    await expect(getObservation.execute(randomUUID())).resolves.toBeNull();
  });
});
