import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type {
  IdempotencyCheck,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type {
  SyncChangeInput,
  SyncChangeRecorder,
} from '../../../platform/sync/sync-change-recorder.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GardenRole, MembershipRepository } from '../../gardens-mapping/public.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';
import type { ImageAnalysisResultRepository } from './image-analysis-result-repository.js';
import type { ObservationPhotoRepository } from './observation-photo-repository.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';
import type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from './observations-history-unit-of-work.js';
import type { PlantOwnershipRepository } from './plant-ownership-repository.js';
import { RecordObservation, type RecordObservationInput } from './record-observation.js';

const GARDEN_ID = randomUUID();
const OTHER_GARDEN_ID = randomUUID();
const PROFILE_ID = randomUUID();
const PLANT_ID = randomUUID();
const GARDEN_OBJECT_ID = randomUUID();
const MEDIA_ID = randomUUID();
const NOW = new Date('2026-07-21T09:00:00Z');

function fixedClock(): Clock {
  return { now: () => NOW };
}

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

function authorizationWithRole(role: GardenRole | null): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(role));
}

class FakeObservationRepository implements ObservationRepository {
  readonly rows: Observation[] = [];

  insert(observation: Observation): Promise<void> {
    this.rows.push(observation);
    return Promise.resolve();
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
}

class FakeObservationPhotoRepository implements ObservationPhotoRepository {
  readonly rows: ObservationPhoto[] = [];

  insert(photo: ObservationPhoto): Promise<void> {
    this.rows.push(photo);
    return Promise.resolve();
  }
}

class FakeImageAnalysisResultRepository implements ImageAnalysisResultRepository {
  readonly rows: ImageAnalysisResult[] = [];

  insert(result: ImageAnalysisResult): Promise<void> {
    this.rows.push(result);
    return Promise.resolve();
  }
}

class FakePlantOwnershipRepository implements PlantOwnershipRepository {
  constructor(private readonly gardenIdByPlantId: ReadonlyMap<string, string>) {}

  findGardenId(plantId: string): Promise<string | null> {
    return Promise.resolve(this.gardenIdByPlantId.get(plantId) ?? null);
  }
}

class FakeMediaRepository implements MediaRepository {
  constructor(private readonly existingIds: ReadonlySet<string>) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  get(id: string): Promise<MediaRecord | null> {
    if (!this.existingIds.has(id)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id,
      storageReference: `gs://verdery-media/${id}.jpg`,
      mimeType: 'image/jpeg',
      uploadedByProfileId: PROFILE_ID,
      createdAt: NOW,
    });
  }
}

interface StoredIdempotencyRecord {
  readonly input: IdempotencyRecordInput;
  readonly responseStatusCode: number;
  readonly responseBody: unknown;
}

/** In-memory stand-in for `KyselyIdempotencyStore`'s real check/save/conflict semantics — mirrors `media/application/register-media-record.test.ts`'s own fake. */
class FakeIdempotencyStore implements IdempotencyStore {
  readonly saved: StoredIdempotencyRecord[] = [];

  private matchKey(input: IdempotencyRecordInput): string {
    return `${input.actorProfileId}:${input.operation}:${input.idempotencyKey}`;
  }

  check(input: IdempotencyRecordInput): Promise<IdempotencyCheck> {
    const existing = this.saved.find(
      (record) => this.matchKey(record.input) === this.matchKey(input),
    );

    if (existing === undefined) {
      return Promise.resolve({ kind: 'new' });
    }
    if (existing.input.requestFingerprint !== input.requestFingerprint) {
      return Promise.reject(
        new ConflictError(
          'request.idempotency.key_reused',
          'This idempotency key was already used with a different request.',
        ),
      );
    }
    return Promise.resolve({
      kind: 'replay',
      responseStatusCode: existing.responseStatusCode,
      responseBody: existing.responseBody,
    });
  }

  save(
    input: IdempotencyRecordInput,
    responseStatusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    this.saved.push({ input, responseStatusCode, responseBody });
    return Promise.resolve();
  }
}

class FakeSyncChangeRecorder implements SyncChangeRecorder {
  readonly entries: SyncChangeInput[] = [];

  record(input: SyncChangeInput): Promise<void> {
    this.entries.push(input);
    return Promise.resolve();
  }
}

class FakeUnitOfWork implements ObservationsHistoryUnitOfWork {
  constructor(private readonly context: ObservationsHistoryTransactionContext) {}

  run<T>(work: (context: ObservationsHistoryTransactionContext) => Promise<T>): Promise<T> {
    return work(this.context);
  }
}

interface Harness {
  readonly recordObservation: RecordObservation;
  readonly observations: FakeObservationRepository;
  readonly observationPhotos: FakeObservationPhotoRepository;
  readonly imageAnalysisResults: FakeImageAnalysisResultRepository;
  readonly syncChanges: FakeSyncChangeRecorder;
}

function buildHarness(options: {
  role?: GardenRole | null;
  plantGardenIds?: ReadonlyMap<string, string>;
  mediaIds?: ReadonlySet<string>;
}): Harness {
  const observations = new FakeObservationRepository();
  const observationPhotos = new FakeObservationPhotoRepository();
  const imageAnalysisResults = new FakeImageAnalysisResultRepository();
  const idempotency = new FakeIdempotencyStore();
  const syncChanges = new FakeSyncChangeRecorder();
  const context: ObservationsHistoryTransactionContext = {
    observations,
    observationPhotos,
    imageAnalysisResults,
    plants: new FakePlantOwnershipRepository(options.plantGardenIds ?? new Map()),
    media: new FakeMediaRepository(options.mediaIds ?? new Set()),
    idempotency,
    syncChanges,
  };

  const recordObservation = new RecordObservation(
    idempotency,
    new FakeUnitOfWork(context),
    authorizationWithRole(options.role ?? 'editor'),
    fixedClock(),
  );

  return { recordObservation, observations, observationPhotos, imageAnalysisResults, syncChanges };
}

const NOTE_ONLY_INPUT: RecordObservationInput = {
  plantId: null,
  gardenObjectId: null,
  noteText: 'Leaves look wilted.',
  conditionSummary: null,
  observedAt: null,
  photoMediaIds: [],
};

describe('RecordObservation', () => {
  it('records a plant-level observation and returns it uncorrected', async () => {
    const { recordObservation, observations, syncChanges } = buildHarness({
      plantGardenIds: new Map([[PLANT_ID, GARDEN_ID]]),
    });

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
      randomUUID(),
    );

    expect(resource).toMatchObject({
      gardenId: GARDEN_ID,
      plantId: PLANT_ID,
      gardenObjectId: null,
      noteText: 'Leaves look wilted.',
      isCorrected: false,
      photos: [],
    });
    expect(observations.rows).toHaveLength(1);
    expect(syncChanges.entries).toEqual([
      {
        gardenId: GARDEN_ID,
        recordId: resource.id,
        recordType: 'observation',
        operation: 'upsert',
        recordRevision: 1,
      },
    ]);
  });

  it('records a garden-object (area-level) observation', async () => {
    const { recordObservation } = buildHarness({});

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...NOTE_ONLY_INPUT, gardenObjectId: GARDEN_OBJECT_ID, noteText: 'Bed is dry.' },
      randomUUID(),
    );

    expect(resource.plantId).toBeNull();
    expect(resource.gardenObjectId).toBe(GARDEN_OBJECT_ID);
  });

  it('records a photo-only observation, inserting one photo row and one stubbed, requires-confirmation analysis result', async () => {
    const { recordObservation, observationPhotos, imageAnalysisResults } = buildHarness({
      mediaIds: new Set([MEDIA_ID]),
    });

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...NOTE_ONLY_INPUT, noteText: null, photoMediaIds: [MEDIA_ID] },
      randomUUID(),
    );

    expect(resource.noteText).toBeNull();
    expect(resource.photos).toHaveLength(1);
    expect(resource.photos[0]).toMatchObject({ mediaId: MEDIA_ID });
    expect(resource.photos[0]?.analysisResults[0]).toMatchObject({
      requiresConfirmation: true,
      analysisKind: 'other',
    });
    expect(observationPhotos.rows).toHaveLength(1);
    expect(imageAnalysisResults.rows).toHaveLength(1);
    expect(imageAnalysisResults.rows[0]?.requiresConfirmation).toBe(true);
  });

  it('rejects an observation with no note, no summary, and no photos, inserting nothing', async () => {
    const { recordObservation, observations } = buildHarness({});

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, noteText: null },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(0);
  });

  it('rejects a plantId that belongs to a different garden', async () => {
    const { recordObservation, observations } = buildHarness({
      plantGardenIds: new Map([[PLANT_ID, OTHER_GARDEN_ID]]),
    });

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(0);
  });

  it('rejects a plantId that does not exist at all', async () => {
    const { recordObservation } = buildHarness({});

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a photoMediaId that does not resolve to an existing media record, inserting no photo or analysis row for it', async () => {
    const { recordObservation, observationPhotos, imageAnalysisResults } = buildHarness({});

    // The fake unit of work runs `work` directly with no real rollback (see
    // `FakeUnitOfWork` above, the same simplification media's own fake makes)
    // — the observation row itself, inserted before this check runs, is
    // therefore not asserted un-inserted here. The real, transactional
    // `KyselyObservationsHistoryUnitOfWork` rolls the whole transaction back
    // on this same thrown error; that "nothing at all is left behind" case
    // is covered by tests/integration/observations-history.test.ts instead.
    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, noteText: null, photoMediaIds: [MEDIA_ID] },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observationPhotos.rows).toHaveLength(0);
    expect(imageAnalysisResults.rows).toHaveLength(0);
  });

  it('rejects a caller who lacks editGardenContent (a viewer)', async () => {
    const { recordObservation } = buildHarness({ role: 'viewer' });

    await expect(
      recordObservation.execute(GARDEN_ID, PROFILE_ID, NOTE_ONLY_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('replays the same idempotency key without inserting a second observation, and rejects a reused key with a different body', async () => {
    const { recordObservation, observations } = buildHarness({});
    const key = randomUUID();

    const first = await recordObservation.execute(GARDEN_ID, PROFILE_ID, NOTE_ONLY_INPUT, key);
    const replay = await recordObservation.execute(GARDEN_ID, PROFILE_ID, NOTE_ONLY_INPUT, key);
    expect(replay).toEqual(first);
    expect(observations.rows).toHaveLength(1);

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, noteText: 'A different note.' },
        key,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
