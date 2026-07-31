/**
 * Shared fakes and harness builder for `record-observation.test.ts` and
 * `record-observation-media.test.ts` — split out of one file once it crossed
 * the 600-line limit (P11-MEDIA-01 added the measurement/phenology/context-
 * snapshot coverage). Not itself a test file — no `describe`/`it` here.
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
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationMeasurement } from '../domain/observation-measurement.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';
import type { ImageAnalysisResultRepository } from './image-analysis-result-repository.js';
import type { ObservationMeasurementRepository } from './observation-measurement-repository.js';
import type { ObservationPhotoRepository } from './observation-photo-repository.js';
import type { ObservationHistoryEntry, ObservationRepository } from './observation-repository.js';
import type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from './observations-history-unit-of-work.js';
import { disabledAnalyzePlantCondition } from './plant-ai-test-doubles.js';
import type { PlantOwnershipRepository } from './plant-ownership-repository.js';
import { RecordObservation, type RecordObservationInput } from './record-observation.js';

export const GARDEN_ID = randomUUID();
export const OTHER_GARDEN_ID = randomUUID();
export const PROFILE_ID = randomUUID();
export const PLANT_ID = randomUUID();
export const GARDEN_OBJECT_ID = randomUUID();
export const MEDIA_ID = randomUUID();
export const NOW = new Date('2026-07-21T09:00:00Z');

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

function authorizationWithRole(
  role: GardenRole | null,
  gardenLifecycleState: GardenLifecycleState = 'active',
): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(role, gardenLifecycleState));
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

export interface Harness {
  readonly recordObservation: RecordObservation;
  readonly observations: FakeObservationRepository;
  readonly observationPhotos: FakeObservationPhotoRepository;
  readonly imageAnalysisResults: FakeImageAnalysisResultRepository;
  readonly syncChanges: FakeSyncChangeRecorder;
}

export function buildHarness(options: {
  role?: GardenRole | null;
  gardenLifecycleState?: GardenLifecycleState;
  plantGardenIds?: ReadonlyMap<string, string>;
  mediaIds?: ReadonlySet<string>;
  contextFacts?: readonly GardenContextFact[];
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
    observationMeasurements: new FakeObservationMeasurementRepository(),
    plants: new FakePlantOwnershipRepository(options.plantGardenIds ?? new Map()),
    media: new FakeMediaRepository(options.mediaIds ?? new Set()),
    gardenContextFacts: new FakeGardenContextFactRepository(options.contextFacts ?? []),
    idempotency,
    syncChanges,
  };

  const recordObservation = new RecordObservation(
    idempotency,
    new FakeUnitOfWork(context),
    authorizationWithRole(options.role ?? 'editor', options.gardenLifecycleState ?? 'active'),
    fixedClock(),
    disabledAnalyzePlantCondition(fixedClock()),
  );

  return { recordObservation, observations, observationPhotos, imageAnalysisResults, syncChanges };
}

export const NOTE_ONLY_INPUT: RecordObservationInput = {
  plantId: null,
  gardenObjectId: null,
  noteText: 'Leaves look wilted.',
  conditionSummary: null,
  observedAt: null,
  photos: [],
  measurements: [],
  observedPhenologicalStage: null,
};
