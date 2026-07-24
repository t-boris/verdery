import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type {
  IdempotencyCheck,
  IdempotencyLookupResult,
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
import { registerMediaRecord } from '../../media/public.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import { createObservation } from '../domain/observation.js';
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';
import { CorrectObservation, type CorrectObservationInput } from './correct-observation.js';
import type { ImageAnalysisResultRepository } from './image-analysis-result-repository.js';
import type { ObservationPhotoRepository } from './observation-photo-repository.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';
import type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from './observations-history-unit-of-work.js';
import type { PlantOwnershipRepository } from './plant-ownership-repository.js';

const GARDEN_ID = randomUUID();
const PROFILE_ID = randomUUID();
const PLANT_ID = randomUUID();
const MEDIA_ID = randomUUID();
const NOW = new Date('2026-07-22T09:00:00Z');

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

  listMembershipsForProfile(): Promise<never[]> {
    throw new Error('not used by this test');
  }
}

function authorizationWithRole(role: GardenRole | null): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(role));
}

class FakeObservationRepository implements ObservationRepository {
  readonly rows: Observation[] = [];

  constructor(seed: readonly Observation[] = []) {
    this.rows.push(...seed);
  }

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

  getWithHistory(): Promise<ObservationHistoryEntry | null> {
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
  findGardenId(): Promise<string | null> {
    throw new Error('not used by this test');
  }
}

class FakeMediaRepository implements MediaRepository {
  constructor(private readonly existingIds: ReadonlySet<string>) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  update(): Promise<boolean> {
    throw new Error('not used by this test');
  }

  get(id: string): Promise<MediaRecord | null> {
    if (!this.existingIds.has(id)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      registerMediaRecord(
        id,
        GARDEN_ID,
        PROFILE_ID,
        'garden_photo',
        'photo.jpg',
        'image/jpeg',
        123_456,
        null,
        null,
        null,
        null,
        NOW,
      ),
    );
  }
}

interface StoredIdempotencyRecord {
  readonly input: IdempotencyRecordInput;
  readonly responseStatusCode: number;
  readonly responseBody: unknown;
}

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

  lookup(
    actorProfileId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<IdempotencyLookupResult | null> {
    const existing = this.saved.find(
      (record) =>
        this.matchKey(record.input) ===
        this.matchKey({ actorProfileId, operation, idempotencyKey, requestFingerprint: '' }),
    );

    return Promise.resolve(
      existing === undefined
        ? null
        : { responseStatusCode: existing.responseStatusCode, responseBody: existing.responseBody },
    );
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

function originalObservation(): Observation {
  return createObservation({
    id: randomUUID(),
    gardenId: GARDEN_ID,
    plantId: PLANT_ID,
    gardenObjectId: null,
    actorProfileId: PROFILE_ID,
    rawNoteText: 'Leaves look wilted.',
    rawConditionSummary: null,
    observedAt: new Date('2026-07-20T08:00:00Z'),
    photoCount: 0,
    now: new Date('2026-07-20T08:00:00Z'),
  });
}

interface Harness {
  readonly correctObservation: CorrectObservation;
  readonly observations: FakeObservationRepository;
  readonly original: Observation;
  readonly syncChanges: FakeSyncChangeRecorder;
}

function buildHarness(options: {
  role?: GardenRole | null;
  mediaIds?: ReadonlySet<string>;
  seedOriginal?: boolean;
}): Harness {
  const original = originalObservation();
  const observations = new FakeObservationRepository(
    options.seedOriginal === false ? [] : [original],
  );
  const syncChanges = new FakeSyncChangeRecorder();
  const context: ObservationsHistoryTransactionContext = {
    observations,
    observationPhotos: new FakeObservationPhotoRepository(),
    imageAnalysisResults: new FakeImageAnalysisResultRepository(),
    plants: new FakePlantOwnershipRepository(),
    media: new FakeMediaRepository(options.mediaIds ?? new Set()),
    idempotency: new FakeIdempotencyStore(),
    syncChanges,
  };
  const idempotency = context.idempotency;

  const correctObservation = new CorrectObservation(
    idempotency,
    new FakeUnitOfWork(context),
    authorizationWithRole(options.role ?? 'editor'),
    observations,
    fixedClock(),
  );

  return { correctObservation, observations, original, syncChanges };
}

const AMENDMENT_INPUT: CorrectObservationInput = {
  correctionKind: 'amendment',
  noteText: 'Leaves recovered after watering.',
  conditionSummary: null,
  photoMediaIds: [],
};

describe('CorrectObservation', () => {
  it('inserts a new row pointing back to the original, leaving the original row in the repository unchanged', async () => {
    const { correctObservation, observations, original } = buildHarness({});
    const originalSnapshot = { ...original };

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      AMENDMENT_INPUT,
      randomUUID(),
    );

    expect(resource).toMatchObject({
      gardenId: original.gardenId,
      plantId: original.plantId,
      correctionKind: 'amendment',
      correctsObservationId: original.id,
      noteText: 'Leaves recovered after watering.',
    });
    expect(observations.rows).toHaveLength(2);
    expect(observations.rows[0]).toEqual(originalSnapshot);
  });

  it("records its own sync-change entry, at the new row's recordId, not the original observation's", async () => {
    const { correctObservation, original, syncChanges } = buildHarness({});

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      AMENDMENT_INPUT,
      randomUUID(),
    );

    expect(syncChanges.entries).toEqual([
      {
        gardenId: original.gardenId,
        recordId: resource.id,
        recordType: 'observation',
        operation: 'upsert',
        recordRevision: 1,
      },
    ]);
    expect(resource.id).not.toBe(original.id);
  });

  it('supports the supersede correction kind', async () => {
    const { correctObservation, original } = buildHarness({});

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      { ...AMENDMENT_INPUT, correctionKind: 'supersede' },
      randomUUID(),
    );

    expect(resource.correctionKind).toBe('supersede');
  });

  it('rejects correcting an observation that does not exist', async () => {
    const { correctObservation } = buildHarness({ seedOriginal: false });

    await expect(
      correctObservation.execute(randomUUID(), PROFILE_ID, AMENDMENT_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a correction with no note, no summary, and no photos', async () => {
    const { correctObservation, original, observations } = buildHarness({});

    await expect(
      correctObservation.execute(
        original.id,
        PROFILE_ID,
        { ...AMENDMENT_INPUT, noteText: null },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(1);
  });

  it('attaches photos, each with a stubbed, requires-confirmation analysis result', async () => {
    const { correctObservation, original } = buildHarness({ mediaIds: new Set([MEDIA_ID]) });

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      { ...AMENDMENT_INPUT, photoMediaIds: [MEDIA_ID] },
      randomUUID(),
    );

    expect(resource.photos).toHaveLength(1);
    expect(resource.photos[0]?.analysisResults[0]?.requiresConfirmation).toBe(true);
  });

  it("rejects a caller who lacks editGardenContent on the original observation's garden", async () => {
    const { correctObservation, original } = buildHarness({ role: 'viewer' });

    await expect(
      correctObservation.execute(original.id, PROFILE_ID, AMENDMENT_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('replays the same idempotency key without inserting a second correction', async () => {
    const { correctObservation, original, observations } = buildHarness({});
    const key = randomUUID();

    const first = await correctObservation.execute(original.id, PROFILE_ID, AMENDMENT_INPUT, key);
    const replay = await correctObservation.execute(original.id, PROFILE_ID, AMENDMENT_INPUT, key);
    expect(replay).toEqual(first);
    expect(observations.rows).toHaveLength(2);
  });
});
