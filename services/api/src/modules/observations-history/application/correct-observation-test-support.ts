/**
 * Shared fakes and harness builder for `correct-observation.test.ts` and
 * `correct-observation-media.test.ts` — split out of one file once it
 * crossed the 600-line limit (P11-HEALTH-01 extended
 * `ImageAnalysisResultRepository`/`ObservationPhotoRepository`'s fakes).
 * Not itself a test file — no `describe`/`it` here. Mirrors
 * `record-observation-test-support.ts`'s identical split.
 */

import { randomUUID } from 'node:crypto';
import { ConflictError } from '../../../platform/errors/application-error.js';
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
import type {
  GardenContextFact,
  GardenContextFactRepository,
  GardenLifecycleState,
  GardenRole,
  MembershipRepository,
} from '../../gardens-mapping/public.js';
import { registerMediaRecord } from '../../media/public.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import { createObservation } from '../domain/observation.js';
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationMeasurement } from '../domain/observation-measurement.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';
import { CorrectObservation, type CorrectObservationInput } from './correct-observation.js';
import type {
  ImageAnalysisResultRepository,
  ImageAnalysisResultWithGardenContext,
} from './image-analysis-result-repository.js';
import type { ObservationMeasurementRepository } from './observation-measurement-repository.js';
import type {
  ObservationPhotoRepository,
  PlantJournalFrame,
  PlantPhotoHistoryEntry,
} from './observation-photo-repository.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';
import type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from './observations-history-unit-of-work.js';
import { disabledAnalyzePlantCondition } from './plant-ai-test-doubles.js';
import type { PlantOwnershipRepository } from './plant-ownership-repository.js';

export const GARDEN_ID = randomUUID();
export const PROFILE_ID = randomUUID();
export const PLANT_ID = randomUUID();
export const MEDIA_ID = randomUUID();
export const NOW = new Date('2026-07-22T09:00:00Z');

export function fixedClock(): Clock {
  return { now: () => NOW };
}

class FakeMembershipRepository implements MembershipRepository {
  constructor(
    private readonly role: GardenRole | null,
    private readonly gardenLifecycleState: GardenLifecycleState = 'active',
  ) {}

  findGardenAccess() {
    if (this.role === null) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      membership: {
        id: randomUUID(),
        gardenId: GARDEN_ID,
        profileId: PROFILE_ID,
        role: this.role,
      },
      gardenLifecycleState: this.gardenLifecycleState,
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

  listAnalysisHistoryForPlant(): Promise<readonly PlantPhotoHistoryEntry[]> {
    return Promise.resolve([]);
  }

  /** Empty by construction: these doubles serve the record/correct use cases, which never read a journal sequence. A fake that invented frames here would let a test pass on data no production path produces. */
  listJournalFramesForPlant(): Promise<readonly PlantJournalFrame[]> {
    return Promise.resolve([]);
  }
}

class FakeImageAnalysisResultRepository implements ImageAnalysisResultRepository {
  readonly rows: ImageAnalysisResult[] = [];

  insert(result: ImageAnalysisResult): Promise<void> {
    this.rows.push(result);
    return Promise.resolve();
  }

  getWithGardenContext(): Promise<ImageAnalysisResultWithGardenContext | null> {
    throw new Error('not used by this test');
  }

  update(): Promise<void> {
    throw new Error('not used by this test');
  }
}

class FakeObservationMeasurementRepository implements ObservationMeasurementRepository {
  readonly rows: ObservationMeasurement[] = [];

  insert(measurement: ObservationMeasurement): Promise<void> {
    this.rows.push(measurement);
    return Promise.resolve();
  }
}

class FakeGardenContextFactRepository implements GardenContextFactRepository {
  constructor(private readonly facts: readonly GardenContextFact[] = []) {}

  recordOrUpdate(): Promise<GardenContextFact> {
    throw new Error('not used by this test');
  }

  listForGarden(): Promise<readonly GardenContextFact[]> {
    return Promise.resolve(this.facts);
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

  findDerivative(): Promise<MediaRecord | null> {
    throw new Error('not used by this test');
  }

  listForGarden(): ReturnType<MediaRepository['listForGarden']> {
    throw new Error('not used by this test');
  }

  listDisplayDerivatives(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  listPurgeCandidates(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  countUndeletedForPurge(): Promise<number> {
    throw new Error('not used by this test');
  }

  scheduleDerivativesForDeletion(): Promise<number> {
    throw new Error('not used by this test');
  }

  markScheduledDerivativesDeleted(): Promise<number> {
    throw new Error('not used by this test');
  }

  listRetentionExpired(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  listStaleUploads(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  get(id: string): Promise<MediaRecord | null> {
    if (!this.existingIds.has(id)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...registerMediaRecord(
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
      // Attachment now requires an `available` record (P6-RET-01's
      // attach-versus-delete guard).
      uploadState: 'available' as const,
    });
  }

  getForShare(id: string): Promise<MediaRecord | null> {
    return this.get(id);
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

export function originalObservation(): Observation {
  return createObservation({
    id: randomUUID(),
    gardenId: GARDEN_ID,
    plantId: PLANT_ID,
    gardenObjectId: null,
    actorProfileId: PROFILE_ID,
    rawNoteText: 'Leaves look wilted.',
    rawConditionSummary: null,
    rawObservedPhenologicalStage: null,
    contextSnapshot: { sunExposure: null, drainage: null, growingContext: null },
    observedAt: new Date('2026-07-20T08:00:00Z'),
    photoCount: 0,
    now: new Date('2026-07-20T08:00:00Z'),
  });
}

export interface Harness {
  readonly correctObservation: CorrectObservation;
  readonly observations: FakeObservationRepository;
  readonly original: Observation;
  readonly syncChanges: FakeSyncChangeRecorder;
}

export function buildHarness(options: {
  role?: GardenRole | null;
  mediaIds?: ReadonlySet<string>;
  seedOriginal?: boolean;
  contextFacts?: readonly GardenContextFact[];
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
    observationMeasurements: new FakeObservationMeasurementRepository(),
    plants: new FakePlantOwnershipRepository(),
    media: new FakeMediaRepository(options.mediaIds ?? new Set()),
    gardenContextFacts: new FakeGardenContextFactRepository(options.contextFacts ?? []),
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
    disabledAnalyzePlantCondition(fixedClock()),
  );

  return { correctObservation, observations, original, syncChanges };
}

export const AMENDMENT_INPUT: CorrectObservationInput = {
  correctionKind: 'amendment',
  noteText: 'Leaves recovered after watering.',
  conditionSummary: null,
  photos: [],
  measurements: [],
  observedPhenologicalStage: null,
};
