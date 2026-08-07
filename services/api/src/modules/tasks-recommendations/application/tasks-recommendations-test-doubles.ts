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
  IdempotencyLookupResult,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender, OutboxEventInput } from '../../../platform/outbox/outbox-appender.js';
import type {
  SyncChangeInput,
  SyncChangeRecorder,
} from '../../../platform/sync/sync-change-recorder.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type {
  GardenLifecycleState,
  GardenRole,
  MapObject,
  MapObjectRepository,
  MapObjectSummary,
  MembershipRepository,
  ViewportBoundingBox,
} from '../../gardens-mapping/public.js';
import type {
  Observation,
  ObservationHistoryEntry,
  ObservationRepository,
} from '../../observations-history/public.js';
import { GetObservation } from '../../observations-history/public.js';
import type {
  BedOccupancyPeriod,
  Plant,
  PlantRepository,
  TaxonomyReference,
  TaxonomySeasonalFact,
} from '../../plants-inventory/public.js';
import type { Task } from '../domain/task.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import type { TaskAttachment } from '../domain/task-attachment.js';
import {
  FakeAiExplanationRecordRepository,
  FakeBedOccupancyHistoryReader,
  FakeRecommendationCandidateRepository,
  FakeRuleVersionRepository,
  FakeTaxonomyReferenceRepository,
  FakeTaxonomySeasonalFactRepository,
} from './recommendation-test-doubles.js';
import { FakeMediaRepository } from './tasks-recommendations-media-test-double.js';
import type { TaskAttachmentRepository } from './task-attachment-repository.js';
import type { TaskActivityEntry, TaskActivityRepository } from './task-activity-repository.js';
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
    originRecommendationId: null,
    revision: 1,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    completedAt: null,
    assignedProfileId: null,
    assignedAt: null,
    completedByProfileId: null,
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

  listCompletedSince(gardenId: Uuid, since: Date): Promise<Task[]> {
    const matches = [...this.tasks.values()]
      .filter(
        (task) =>
          task.gardenId === gardenId &&
          task.status === 'completed' &&
          task.completedAt !== null &&
          task.completedAt.getTime() >= since.getTime(),
      )
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
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

/** `GetTaskActivity`'s read port, backed by the same entries a `FakeTaskRevisionJournalWriter` collected — the two are deliberately separate fakes (matching the separate read/write ports they stand in for), but a test can seed one from the other via `activityFromJournal` below. */
export class FakeTaskActivityRepository implements TaskActivityRepository {
  constructor(private readonly entriesByTask: Map<Uuid, TaskActivityEntry[]> = new Map()) {}

  listForTask(taskId: Uuid): Promise<TaskActivityEntry[]> {
    return Promise.resolve(this.entriesByTask.get(taskId) ?? []);
  }
}

/** Projects a written journal entry into the shape `TaskActivityRepository` reads back, stamping a deterministic `recordedAt` — the same field the real `task_revision.recorded_at` default supplies. */
export function activityFromJournal(
  entry: TaskRevisionJournalEntry,
  recordedAt: Date,
): TaskActivityEntry {
  return {
    revision: entry.revision,
    commandType: entry.commandType,
    actorProfileId: entry.actorProfileId,
    status: entry.status,
    dueDate: entry.dueDate,
    assignedProfileId: entry.assignedProfileId,
    recordedAt,
  };
}

export class FakeSyncChangeRecorder implements SyncChangeRecorder {
  readonly entries: SyncChangeInput[] = [];

  record(input: SyncChangeInput): Promise<void> {
    this.entries.push(input);
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

  updateLifecycle(): Promise<boolean> {
    throw new Error('not used by this test');
  }

  listForGarden(_gardenId: Uuid, _viewport: ViewportBoundingBox | null): Promise<MapObject[]> {
    throw new Error('not used by this test');
  }
}

/** `findById` serves the task commands; `search` serves `EvaluateGardenRecommendations`' fact gathering (unfiltered scan with a numeric-offset cursor — enough paging to be honest with the port's contract). */
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

  search(
    gardenId: Uuid,
    filters: Parameters<PlantRepository['search']>[1],
    cursor: string | null,
    limit: number,
  ): ReturnType<PlantRepository['search']> {
    const matching = [...this.plants.values()].filter(
      (plant) =>
        plant.gardenId === gardenId &&
        (filters.lifecycleStage === null ||
          filters.lifecycleStage.includes(plant.lifecycleStage)) &&
        (filters.status === null || filters.status.includes(plant.status)) &&
        (filters.groupingKind === null || filters.groupingKind.includes(plant.groupingKind)),
    );
    const offset = cursor === null ? 0 : Number(cursor);
    const items = matching.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return Promise.resolve({
      items,
      nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
    });
  }
}

/** `get` serves `GetObservation` (built into a real instance below); `listForGarden` serves `EvaluateGardenRecommendations`' fact gathering, photo-less like an observation without attachments. */
export class FakeObservationRepository implements ObservationRepository {
  constructor(private readonly observations: Map<Uuid, Observation> = new Map()) {}

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  get(id: Uuid): Promise<Observation | null> {
    return Promise.resolve(this.observations.get(id) ?? null);
  }

  listForGarden(gardenId: Uuid): Promise<ObservationHistoryEntry[]> {
    const all = [...this.observations.values()];
    const entries = all
      .filter((observation) => observation.gardenId === gardenId)
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
      .map((observation) => ({
        observation,
        isCorrected: all.some((later) => later.correctsObservationId === observation.id),
        photos: [],
        measurements: [],
        symptoms: [],
      }));
    return Promise.resolve(entries);
  }

  listForPlant(): Promise<ObservationHistoryEntry[]> {
    throw new Error('not used by this test');
  }

  getWithHistory(): Promise<ObservationHistoryEntry | null> {
    throw new Error('not used by this test');
  }
}

/** A real `GetObservation` backed by a fake repository, the same "real concrete class over a fake port" construction `authorizationGranting` below uses for `GardenAuthorization`. */
export function getObservationResolving(observations: Map<Uuid, Observation>): GetObservation {
  return new GetObservation(new FakeObservationRepository(observations));
}

/**
 * Backed by every membership passed in, keyed by `profileId` — needed the
 * moment a command checks TWO different profiles' capabilities against the
 * same garden in one call (P9A-TASK-01's `AssignTask`: the actor AND the
 * proposed assignee). A single-membership fake would silently answer every
 * profile identically, which is exactly the bug this shape exists to make
 * impossible to write.
 */
export class FakeMembershipRepository implements MembershipRepository {
  private readonly membershipsByProfile: ReadonlyMap<Uuid, FakeMembership>;

  constructor(
    memberships: FakeMembership | readonly FakeMembership[] | null,
    private readonly gardenLifecycleState: GardenLifecycleState = 'active',
  ) {
    const list: readonly FakeMembership[] =
      memberships === null ? [] : Array.isArray(memberships) ? memberships : [memberships];
    this.membershipsByProfile = new Map(
      list.map((membership): [Uuid, FakeMembership] => [membership.profileId, membership]),
    );
  }

  findGardenAccess(
    _gardenId: Uuid,
    profileId: Uuid,
  ): ReturnType<MembershipRepository['findGardenAccess']> {
    const membership = this.membershipsByProfile.get(profileId);
    return Promise.resolve(
      membership === undefined
        ? null
        : { membership, gardenLifecycleState: this.gardenLifecycleState },
    );
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): ReturnType<MembershipRepository['listMembershipsForProfile']> {
    throw new Error('not used by this test');
  }

  listForGarden(): ReturnType<MembershipRepository['listForGarden']> {
    throw new Error('not used by this test');
  }

  listDetailsForProfile(): ReturnType<MembershipRepository['listDetailsForProfile']> {
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

/** A real `GardenAuthorization` backed by a fake membership repository — `GardenAuthorization` is a concrete class with a private field, so a hand-rolled substitute is not structurally assignable; this is the same construction `plants-inventory-test-doubles.ts`'s own `authorizationGranting` uses. */
export function authorizationGranting(
  membership: FakeMembership,
  gardenLifecycleState: GardenLifecycleState = 'active',
): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(membership, gardenLifecycleState));
}

/** `authorizationGranting`'s multi-profile counterpart — for commands like `AssignTask` that must resolve capabilities for more than one profile against the same garden in a single call. */
export function authorizationGrantingMany(
  memberships: readonly FakeMembership[],
  gardenLifecycleState: GardenLifecycleState = 'active',
): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(memberships, gardenLifecycleState));
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

  lookup(
    actorProfileId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<IdempotencyLookupResult | null> {
    const existing = this.saved.find(
      (record) =>
        this.matchKey(record.input) ===
        this.matchKey({
          actorProfileId,
          operation,
          idempotencyKey,
          requestFingerprint: '',
        }),
    );

    return Promise.resolve(
      existing === undefined
        ? null
        : { responseStatusCode: existing.responseStatusCode, responseBody: existing.responseBody },
    );
  }
}

/** Records every appended event; never publishes anywhere — the same shape `media-test-doubles.ts`'s own `FakeOutboxAppender` uses, duplicated locally because module test doubles are not part of any `public.ts` surface. */
export class FakeOutboxAppender implements OutboxAppender {
  readonly events: OutboxEventInput[] = [];

  append(input: OutboxEventInput): Promise<void> {
    this.events.push(input);
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
  readonly observations: FakeObservationRepository;
  readonly syncChanges: FakeSyncChangeRecorder;
  readonly ruleVersions: FakeRuleVersionRepository;
  readonly recommendationCandidates: FakeRecommendationCandidateRepository;
  readonly outbox: FakeOutboxAppender;
  readonly aiExplanations: FakeAiExplanationRecordRepository;
  readonly taxonomyReferences: FakeTaxonomyReferenceRepository;
  readonly taxonomySeasonalFacts: FakeTaxonomySeasonalFactRepository;
  readonly bedOccupancyHistory: FakeBedOccupancyHistoryReader;
}

export function createTasksRecommendationsFakes(options?: {
  mapObjectSummaries?: Map<Uuid, MapObjectSummary>;
  plants?: Map<Uuid, Plant>;
  observations?: Map<Uuid, Observation>;
  taxonomyReferences?: Map<Uuid, TaxonomyReference>;
  taxonomySeasonalFacts?: Map<string, TaxonomySeasonalFact>;
  bedOccupancyPeriods?: Map<Uuid, readonly BedOccupancyPeriod[]>;
}): TasksRecommendationsFakes {
  const ruleVersions = new FakeRuleVersionRepository();
  const recommendationCandidates = new FakeRecommendationCandidateRepository(ruleVersions);
  return {
    tasks: new FakeTaskRepository(),
    taskAttachments: new FakeTaskAttachmentRepository(),
    revisionJournal: new FakeTaskRevisionJournalWriter(),
    idempotency: new FakeIdempotencyStore(),
    mapObjects: new FakeMapObjectRepository(options?.mapObjectSummaries),
    plants: new FakePlantRepository(options?.plants),
    media: new FakeMediaRepository(),
    observations: new FakeObservationRepository(options?.observations),
    syncChanges: new FakeSyncChangeRecorder(),
    ruleVersions,
    recommendationCandidates,
    outbox: new FakeOutboxAppender(),
    aiExplanations: new FakeAiExplanationRecordRepository(recommendationCandidates),
    taxonomyReferences: new FakeTaxonomyReferenceRepository(options?.taxonomyReferences),
    taxonomySeasonalFacts: new FakeTaxonomySeasonalFactRepository(options?.taxonomySeasonalFacts),
    bedOccupancyHistory: new FakeBedOccupancyHistoryReader(options?.bedOccupancyPeriods),
  };
}

/** Not transactional, unlike `KyselyTasksRecommendationsUnitOfWork` — a unit test does not need a real rollback, only the same context shape. */
export class FakeTasksRecommendationsUnitOfWork implements TasksRecommendationsUnitOfWork {
  constructor(private readonly fakes: TasksRecommendationsFakes) {}

  run<T>(work: (context: TasksRecommendationsTransactionContext) => Promise<T>): Promise<T> {
    return work(this.fakes);
  }
}
