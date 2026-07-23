/**
 * Shared in-memory test doubles for this module's own use-case unit tests
 * (each `*.test.ts` file alongside a command in this directory) — the same
 * shape of fakes `media/application/register-media-record.test.ts` defines
 * inline for its own single command, pulled into one shared file here
 * because this module has nine command handlers, not one, and would
 * otherwise redefine the same handful of fakes nine times.
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
import type { PlantIdentification } from '../domain/plant-identification.js';
import type { PlantPhoto } from '../domain/plant-photo.js';
import type { Plant } from '../domain/plant.js';
import type { PlantIdentificationRepository } from './plant-identification-repository.js';
import type { PlantPhotoRepository } from './plant-photo-repository.js';
import type { PlantRepository, PlantSearchFilters, PlantSearchPage } from './plant-repository.js';
import type {
  PlantsInventoryTransactionContext,
  PlantsInventoryUnitOfWork,
} from './plants-inventory-unit-of-work.js';
import type {
  PlantRevisionJournalEntry,
  PlantRevisionJournalWriter,
} from './plant-revision-journal-writer.js';

/**
 * `gardens-mapping`'s own `Membership` domain type is not exported through
 * its `public.ts` — only `MembershipRepository`, the port, is. This is the
 * same shape, defined locally, purely to build a `FakeMembershipRepository`
 * for tests.
 */
export interface FakeMembership {
  readonly id: string;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
}

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

/** A minimal, valid `Plant` for tests that need one already stored, with any field overridable. */
export function buildPlant(overrides: Partial<Plant> & { id: Uuid; gardenId: Uuid }): Plant {
  return {
    displayName: 'Tomato',
    taxonomyReferenceId: null,
    varietyLabel: null,
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'planned',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

export class FakePlantRepository implements PlantRepository {
  readonly plants = new Map<Uuid, Plant>();

  findById(plantId: Uuid): Promise<Plant | null> {
    return Promise.resolve(this.plants.get(plantId) ?? null);
  }

  insert(plant: Plant): Promise<void> {
    this.plants.set(plant.id, plant);
    return Promise.resolve();
  }

  update(plant: Plant, expectedRevision: number): Promise<boolean> {
    const existing = this.plants.get(plant.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.plants.set(plant.id, plant);
    return Promise.resolve(true);
  }

  /**
   * Not a real trigram implementation — `query` here is a plain
   * case-insensitive substring test against `displayName`, sufficient for
   * `SearchPlants`'s own unit tests (authorization delegation, filter
   * pass-through, resource mapping). Real trigram-ranking and keyset-cursor
   * behavior is exercised only against real PostgreSQL, in
   * `tests/integration/plants-inventory-search.test.ts` — the same split
   * `FakeTaskRepository.listForGarden` already draws for `TaskRepository`.
   * Pagination here is a simple index-into-the-sorted-array cursor, not the
   * real opaque-JSON encoding `KyselyPlantRepository` uses.
   */
  search(
    gardenId: Uuid,
    filters: PlantSearchFilters,
    cursor: string | null,
    limit: number,
  ): Promise<PlantSearchPage> {
    const matches = [...this.plants.values()]
      .filter((plant) => plant.gardenId === gardenId)
      .filter(
        (plant) =>
          filters.query === null ||
          plant.displayName.toLowerCase().includes(filters.query.toLowerCase()),
      )
      .filter(
        (plant) =>
          filters.lifecycleStage === null || filters.lifecycleStage.includes(plant.lifecycleStage),
      )
      .filter((plant) => filters.status === null || filters.status.includes(plant.status))
      .filter(
        (plant) =>
          filters.groupingKind === null || filters.groupingKind.includes(plant.groupingKind),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));

    const start = cursor === null ? 0 : Number(cursor);
    const pageItems = matches.slice(start, start + limit);
    const hasMore = start + limit < matches.length;

    return Promise.resolve({
      items: pageItems,
      nextCursor: hasMore ? String(start + limit) : null,
    });
  }
}

export class FakePlantPhotoRepository implements PlantPhotoRepository {
  readonly photos = new Map<Uuid, PlantPhoto>();

  findById(plantId: Uuid, plantPhotoId: Uuid): Promise<PlantPhoto | null> {
    const photo = this.photos.get(plantPhotoId);
    return Promise.resolve(photo !== undefined && photo.plantId === plantId ? photo : null);
  }

  insert(photo: PlantPhoto): Promise<void> {
    this.photos.set(photo.id, photo);
    return Promise.resolve();
  }

  clearPrimaryForPlant(plantId: Uuid): Promise<void> {
    for (const [id, photo] of this.photos) {
      if (photo.plantId === plantId && photo.isPrimary) {
        this.photos.set(id, { ...photo, isPrimary: false });
      }
    }
    return Promise.resolve();
  }

  setPrimary(plantPhotoId: Uuid): Promise<void> {
    const photo = this.photos.get(plantPhotoId);
    if (photo !== undefined) {
      this.photos.set(plantPhotoId, { ...photo, isPrimary: true });
    }
    return Promise.resolve();
  }
}

export class FakePlantIdentificationRepository implements PlantIdentificationRepository {
  readonly identifications = new Map<Uuid, PlantIdentification>();

  findById(identificationId: Uuid): Promise<PlantIdentification | null> {
    return Promise.resolve(this.identifications.get(identificationId) ?? null);
  }

  insert(identification: PlantIdentification): Promise<void> {
    this.identifications.set(identification.id, identification);
    return Promise.resolve();
  }
}

export class FakePlantRevisionJournalWriter implements PlantRevisionJournalWriter {
  readonly entries: PlantRevisionJournalEntry[] = [];

  record(entry: PlantRevisionJournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

/** Every method a `plantId`/`objectId`-scoped lookup could need; only `findById` is exercised by this module's own commands. */
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

export class FakeMembershipRepository implements MembershipRepository {
  constructor(private readonly membership: FakeMembership | null) {}

  findActiveMembership(): ReturnType<MembershipRepository['findActiveMembership']> {
    return Promise.resolve(this.membership);
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }
}

/** A real `GardenAuthorization` backed by a fake membership repository — `GardenAuthorization` is a concrete class with a private field, so a hand-rolled substitute is not structurally assignable; this is the same construction `garden-authorization.test.ts` itself uses. */
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

/** In-memory stand-in for `KyselyIdempotencyStore`'s real check/save/conflict semantics — the same shape media's own `FakeIdempotencyStore` uses. */
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

export interface PlantsInventoryFakes {
  readonly plants: FakePlantRepository;
  readonly plantPhotos: FakePlantPhotoRepository;
  readonly plantIdentifications: FakePlantIdentificationRepository;
  readonly revisionJournal: FakePlantRevisionJournalWriter;
  readonly idempotency: FakeIdempotencyStore;
  readonly mapObjects: FakeMapObjectRepository;
  readonly media: FakeMediaRepository;
}

export function createPlantsInventoryFakes(
  mapObjectSummaries: Map<Uuid, MapObjectSummary> = new Map(),
): PlantsInventoryFakes {
  return {
    plants: new FakePlantRepository(),
    plantPhotos: new FakePlantPhotoRepository(),
    plantIdentifications: new FakePlantIdentificationRepository(),
    revisionJournal: new FakePlantRevisionJournalWriter(),
    idempotency: new FakeIdempotencyStore(),
    mapObjects: new FakeMapObjectRepository(mapObjectSummaries),
    media: new FakeMediaRepository(),
  };
}

/** Not transactional, unlike `KyselyPlantsInventoryUnitOfWork` — a unit test does not need a real rollback, only the same context shape. */
export class FakePlantsInventoryUnitOfWork implements PlantsInventoryUnitOfWork {
  constructor(private readonly fakes: PlantsInventoryFakes) {}

  run<T>(work: (context: PlantsInventoryTransactionContext) => Promise<T>): Promise<T> {
    return work(this.fakes);
  }
}
