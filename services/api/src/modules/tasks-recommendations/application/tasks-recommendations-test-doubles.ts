/**
 * Shared in-memory test doubles for this module's own use-case unit tests
 * (each `*.test.ts` file alongside a command in this directory) — the same
 * shape of fakes `plants-inventory/application/plants-inventory-test-doubles.ts`
 * defines for its own nine command handlers, pulled into one shared file here
 * for the identical reason: this module has nine command/query handlers, not
 * one.
 *
 * Not itself a `*.test.ts` file, so vitest never runs it as a suite; it
 * exists only to be imported by ones that do.
 */

import { ConflictError } from '../../../platform/errors/application-error.js';
import type {
  IdempotencyCheck,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type {
  GardenRole,
  MapObject,
  MapObjectRepository,
  MapObjectSummary,
  MembershipRepository,
  ViewportBoundingBox,
} from '../../gardens-mapping/public.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import type {
  Observation,
  ObservationHistoryEntry,
  ObservationRepository,
} from '../../observations-history/public.js';
import { GetObservation } from '../../observations-history/public.js';
import type { Plant, PlantRepository } from '../../plants-inventory/public.js';
import type { Task } from '../domain/task.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import type { TaskAttachment } from '../domain/task-attachment.js';
import type { TaskAttachmentRepository } from './task-attachment-repository.js';
import type { TaskRepository } from './task-repository.js';
import type {
  TaskRevisionJournalEntry,
  TaskRevisionJournalWriter,
} from './task-revision-journal-writer.js';
import type {
  TasksRecommendationsTransactionContext,
  TasksRecommendationsUnitOfWork,
} from './tasks-recommendations-unit-of-work.js';

export interface FakeMembership {
  readonly id: string;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
}

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

/** A minimal, valid, `'planned'` `Task` for tests that need one already stored, with any field overridable. */
export function buildTask(overrides: Partial<Task> & { id: Uuid; gardenId: Uuid }): Task {
  return {
    targetKind: 'garden',
    targetGardenAreaMapObjectId: null,
    targetPlantId: null,
    title: 'Water the tomatoes',
    notes: null,
    status: 'planned',
    dueDate: null,
    timeWindowStart: null,
    timeWindowEnd: null,
    recurrenceRule: null,
    urgency: 'normal',
    source: 'manual',
    originObservationId: null,
    revision: 1,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

export class FakeTaskRepository implements TaskRepository {
  readonly tasks = new Map<Uuid, Task>();

  findById(taskId: Uuid): Promise<Task | null> {
    return Promise.resolve(this.tasks.get(taskId) ?? null);
  }

  insert(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
    return Promise.resolve();
  }

  update(task: Task, expectedRevision: number): Promise<boolean> {
    const existing = this.tasks.get(task.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.tasks.set(task.id, task);
    return Promise.resolve(true);
  }

  listForGarden(gardenId: Uuid, statusFilter: readonly TaskStatus[] | null): Promise<Task[]> {
    const matches = [...this.tasks.values()].filter(
      (task) =>
        task.gardenId === gardenId && (statusFilter === null || statusFilter.includes(task.status)),
    );
    return Promise.resolve(matches);
  }
}

export class FakeTaskAttachmentRepository implements TaskAttachmentRepository {
  readonly attachments = new Map<Uuid, TaskAttachment>();

  insert(attachment: TaskAttachment): Promise<void> {
    this.attachments.set(attachment.id, attachment);
    return Promise.resolve();
  }
}

export class FakeTaskRevisionJournalWriter implements TaskRevisionJournalWriter {
  readonly entries: TaskRevisionJournalEntry[] = [];

  record(entry: TaskRevisionJournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

/** Every method a `gardenId`/`objectId`-scoped lookup could need; only `findById` is exercised by this module's own commands. */
export class FakeMapObjectRepository implements MapObjectRepository {
  constructor(private readonly summaries: Map<Uuid, MapObjectSummary> = new Map()) {}

  findById(gardenId: Uuid, objectId: Uuid): Promise<MapObjectSummary | null> {
    const summary = this.summaries.get(objectId);
    return Promise.resolve(summary !== undefined && summary.gardenId === gardenId ? summary : null);
  }

  findByIdWithDetails(): Promise<MapObject | null> {
    throw new Error('not used by this test');
  }

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  update(): Promise<boolean> {
    throw new Error('not used by this test');
  }

  listForGarden(_gardenId: Uuid, _viewport: ViewportBoundingBox | null): Promise<MapObject[]> {
    throw new Error('not used by this test');
  }
}

/** Every method a `plantId`-scoped lookup could need; only `findById` is exercised by this module's own commands. */
export class FakePlantRepository implements PlantRepository {
  constructor(private readonly plants: Map<Uuid, Plant> = new Map()) {}

  findById(plantId: Uuid): Promise<Plant | null> {
    return Promise.resolve(this.plants.get(plantId) ?? null);
  }

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  update(): Promise<boolean> {
    throw new Error('not used by this test');
  }
}

export class FakeMediaRepository implements MediaRepository {
  readonly records = new Map<Uuid, MediaRecord>();

  insert(record: MediaRecord): Promise<void> {
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  get(id: Uuid): Promise<MediaRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }
}

/** Only `get` is exercised — `GetObservation` (used to build a real instance below) never calls the others. */
export class FakeObservationRepository implements ObservationRepository {
  constructor(private readonly observations: Map<Uuid, Observation> = new Map()) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  get(id: Uuid): Promise<Observation | null> {
    return Promise.resolve(this.observations.get(id) ?? null);
  }

  listForGarden(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }

  listForPlant(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }
}

/** A real `GetObservation` backed by a fake repository, the same "real concrete class over a fake port" construction `authorizationGranting` below uses for `GardenAuthorization`. */
export function getObservationResolving(observations: Map<Uuid, Observation>): GetObservation {
  return new GetObservation(new FakeObservationRepository(observations));
}

export class FakeMembershipRepository implements MembershipRepository {
  constructor(private readonly membership: FakeMembership | null) {}

  findActiveMembership(): ReturnType<MembershipRepository['findActiveMembership']> {
    return Promise.resolve(this.membership);
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }
}

/** A real `GardenAuthorization` backed by a fake membership repository — `GardenAuthorization` is a concrete class with a private field, so a hand-rolled substitute is not structurally assignable; this is the same construction `plants-inventory-test-doubles.ts`'s own `authorizationGranting` uses. */
export function authorizationGranting(membership: FakeMembership): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(membership));
}

export function authorizationDenying(): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(null));
}

interface StoredIdempotencyRecord {
  readonly input: IdempotencyRecordInput;
  readonly responseStatusCode: number;
  readonly responseBody: unknown;
}

/** In-memory stand-in for `KyselyIdempotencyStore`'s real check/save/conflict semantics — the same shape `plants-inventory-test-doubles.ts`'s own fake uses. */
export class FakeIdempotencyStore implements IdempotencyStore {
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

export interface TasksRecommendationsFakes {
  readonly tasks: FakeTaskRepository;
  readonly taskAttachments: FakeTaskAttachmentRepository;
  readonly revisionJournal: FakeTaskRevisionJournalWriter;
  readonly idempotency: FakeIdempotencyStore;
  readonly mapObjects: FakeMapObjectRepository;
  readonly plants: FakePlantRepository;
  readonly media: FakeMediaRepository;
}

export function createTasksRecommendationsFakes(options?: {
  mapObjectSummaries?: Map<Uuid, MapObjectSummary>;
  plants?: Map<Uuid, Plant>;
}): TasksRecommendationsFakes {
  return {
    tasks: new FakeTaskRepository(),
    taskAttachments: new FakeTaskAttachmentRepository(),
    revisionJournal: new FakeTaskRevisionJournalWriter(),
    idempotency: new FakeIdempotencyStore(),
    mapObjects: new FakeMapObjectRepository(options?.mapObjectSummaries),
    plants: new FakePlantRepository(options?.plants),
    media: new FakeMediaRepository(),
  };
}

/** Not transactional, unlike `KyselyTasksRecommendationsUnitOfWork` — a unit test does not need a real rollback, only the same context shape. */
export class FakeTasksRecommendationsUnitOfWork implements TasksRecommendationsUnitOfWork {
  constructor(private readonly fakes: TasksRecommendationsFakes) {}

  run<T>(work: (context: TasksRecommendationsTransactionContext) => Promise<T>): Promise<T> {
    return work(this.fakes);
  }
}
