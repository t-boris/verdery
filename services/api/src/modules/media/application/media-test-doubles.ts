/**
 * Shared in-memory test doubles for this module's own command/query unit
 * tests — the same "one shared file, not nine copies" reasoning
 * `plants-inventory/application/plants-inventory-test-doubles.ts` documents
 * for its own module, applied here now that this module has more than one
 * command handler.
 *
 * Not itself a `*.test.ts` file, so vitest never runs it as a suite; it
 * exists only to be imported by ones that do.
 */

import { ConflictError } from '../../../platform/errors/application-error.js';
import type { AuditEventInput, AuditLogger } from '../../../platform/audit/audit-logger.js';
import type {
  IdempotencyCheck,
  IdempotencyLookupResult,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender, OutboxEventInput } from '../../../platform/outbox/outbox-appender.js';
import { PERCEPTUAL_HASH_MATCH_THRESHOLD } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type {
  GardenLifecycleState,
  Membership,
  MembershipRepository,
} from '../../gardens-mapping/public.js';
import type { MediaRecord } from '../domain/media-record.js';
import type { ProcessingJob } from '../domain/processing-job.js';
import type { QuotaReservation } from '../domain/quota-reservation.js';
import type {
  ClientMediaEntitlementGrant,
  ClientMediaEntitlementSource,
} from './client-media-entitlement-source.js';
import type { MediaReferenceFinder, MediaReferenceKind } from './media-reference-finder.js';
import type {
  FindDerivativeInput,
  ListForGardenInput,
  MediaRecordPage,
} from './media-repository.js';
import type { ProcessingJobRepository } from './processing-job-repository.js';
import type {
  MediaObjectMetadata,
  MediaResumableUploadSession,
  MediaSignedDownloadAccess,
  MediaStorageGateway,
  MediaStorageObjectTarget,
} from './media-storage-gateway.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';
import type { MediaPurgeScope, MediaRepository } from './media-repository.js';
import type { QuotaReservationRepository } from './quota-reservation-repository.js';
import type { MediaTransactionContext, MediaUnitOfWork } from './media-unit-of-work.js';

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

export const TEST_BUCKETS: MediaStorageBucketNames = {
  userMedia: 'test-user-media',
  rawCapture: 'test-raw-capture',
  derived: 'test-derived',
  exports: 'test-exports',
};

/** Mirrors the `bit_count(a # b)` the real query delegates to PostgreSQL. */
function hammingDistance(left: string, right: string): number {
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let bits = 0;
  while (difference > 0n) {
    bits += Number(difference & 1n);
    difference >>= 1n;
  }
  return bits;
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

  /** No real lock in memory — a unit test needs the same read, not the `FOR SHARE` serialization (that lives in the Testcontainers integration tests). */
  getForShare(id: Uuid): Promise<MediaRecord | null> {
    return this.get(id);
  }

  update(record: MediaRecord, expectedRevision: number): Promise<boolean> {
    const existing = this.records.get(record.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.records.set(record.id, record);
    return Promise.resolve(true);
  }

  /** In-memory mirror of the bulk `available` -> `deletion_scheduled` derivative transition. */
  scheduleDerivativesForDeletion(derivedFromMediaId: Uuid, now: Date): Promise<number> {
    return Promise.resolve(
      this.bulkTransitionDerivatives(derivedFromMediaId, 'available', 'deletion_scheduled', now),
    );
  }

  /** In-memory mirror of the bulk `deletion_scheduled` -> `deleted` derivative transition. */
  markScheduledDerivativesDeleted(derivedFromMediaId: Uuid, now: Date): Promise<number> {
    return Promise.resolve(
      this.bulkTransitionDerivatives(derivedFromMediaId, 'deletion_scheduled', 'deleted', now),
    );
  }

  private bulkTransitionDerivatives(
    derivedFromMediaId: Uuid,
    from: MediaRecord['uploadState'],
    to: MediaRecord['uploadState'],
    now: Date,
  ): number {
    let transitioned = 0;
    for (const [id, record] of this.records) {
      if (record.derivedFromMediaId === derivedFromMediaId && record.uploadState === from) {
        this.records.set(id, {
          ...record,
          uploadState: to,
          revision: record.revision + 1,
          updatedAt: now,
        });
        transitioned += 1;
      }
    }
    return transitioned;
  }

  /** In-memory mirror of `KyselyMediaRepository.listRetentionExpired`. */
  listRetentionExpired(now: Date, limit: number): Promise<readonly MediaRecord[]> {
    const matches = [...this.records.values()]
      .filter(
        (record) =>
          record.retentionDeadlineAt !== null &&
          record.retentionDeadlineAt.getTime() <= now.getTime() &&
          record.uploadState === 'available' &&
          record.derivedFromMediaId === null,
      )
      .sort(
        (a, b) =>
          (a.retentionDeadlineAt as Date).getTime() - (b.retentionDeadlineAt as Date).getTime(),
      );
    return Promise.resolve(matches.slice(0, limit));
  }

  /** In-memory mirror of `KyselyMediaRepository.listStaleUploads`. */
  listStaleUploads(cutoff: Date, limit: number): Promise<readonly MediaRecord[]> {
    const staleStates = ['registered', 'authorized', 'uploading', 'verifying'];
    const matches = [...this.records.values()]
      .filter(
        (record) =>
          staleStates.includes(record.uploadState) && record.updatedAt.getTime() < cutoff.getTime(),
      )
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    return Promise.resolve(matches.slice(0, limit));
  }

  findDerivative(input: FindDerivativeInput): Promise<MediaRecord | null> {
    const match = [...this.records.values()].find(
      (record) =>
        record.derivedFromMediaId === input.derivedFromMediaId &&
        record.transformationVersion === input.transformationVersion &&
        record.derivativeKind === input.derivativeKind &&
        record.tileZoomLevel === (input.tile?.zoomLevel ?? null) &&
        record.tileX === (input.tile?.x ?? null) &&
        record.tileY === (input.tile?.y ?? null),
    );
    return Promise.resolve(match ?? null);
  }

  /** The most recent `listForGarden` input, so a test can assert what the use case asked for. */
  lastListInput: ListForGardenInput | null = null;

  /** In-memory mirror of `KyselyMediaRepository.listForGarden`: originals only, `(createdAt, id)` descending, opaque index cursor. */
  listForGarden(input: ListForGardenInput): Promise<MediaRecordPage> {
    this.lastListInput = input;
    const ordered = [...this.records.values()]
      .filter(
        (record) =>
          record.gardenId === input.gardenId &&
          record.derivedFromMediaId === null &&
          (input.mediaClass === null || record.mediaClass === input.mediaClass) &&
          (input.checksumSha256 === null || record.checksumSha256 === input.checksumSha256) &&
          (input.similarTo === null ||
            (record.id !== input.similarTo.excludeMediaId &&
              record.perceptualHash !== null &&
              hammingDistance(record.perceptualHash, input.similarTo.perceptualHash) <=
                PERCEPTUAL_HASH_MATCH_THRESHOLD)),
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );

    const start = input.cursor === null ? 0 : Number(input.cursor);
    const items = ordered.slice(start, start + input.limit);
    const nextCursor = start + input.limit < ordered.length ? String(start + input.limit) : null;

    return Promise.resolve({ items, nextCursor });
  }

  /** In-memory mirror of `KyselyMediaRepository.listDisplayDerivatives`: available non-tile derivatives, latest transformation version per kind. */
  listDisplayDerivatives(derivedFromMediaId: Uuid): Promise<readonly MediaRecord[]> {
    const byKind = new Map<string, MediaRecord>();
    for (const record of this.records.values()) {
      if (
        record.derivedFromMediaId !== derivedFromMediaId ||
        record.uploadState !== 'available' ||
        record.derivativeKind === null ||
        record.derivativeKind === 'tile'
      ) {
        continue;
      }
      const existing = byKind.get(record.derivativeKind);
      if (
        existing === undefined ||
        (record.transformationVersion ?? 0) > (existing.transformationVersion ?? 0)
      ) {
        byKind.set(record.derivativeKind, record);
      }
    }
    return Promise.resolve([...byKind.values()]);
  }

  /** In-memory mirror of the purge scope predicate — see `MediaPurgeScope`. */
  listPurgeCandidates(scope: MediaPurgeScope, limit: number): Promise<readonly MediaRecord[]> {
    const candidates = [...this.records.values()].filter(
      (record) =>
        this.inScope(record, scope) &&
        record.derivedFromMediaId === null &&
        record.uploadState !== 'deletion_scheduled' &&
        record.uploadState !== 'deleted',
    );
    return Promise.resolve(candidates.slice(0, limit));
  }

  countUndeletedForPurge(scope: MediaPurgeScope): Promise<number> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (record) => this.inScope(record, scope) && record.uploadState !== 'deleted',
      ).length,
    );
  }

  private inScope(record: MediaRecord, scope: MediaPurgeScope): boolean {
    return scope.kind === 'garden'
      ? record.gardenId === scope.gardenId
      : record.gardenId === null &&
          record.uploadedByProfileId === scope.profileId &&
          record.mediaClass === 'export_package';
  }
}

export class FakeQuotaReservationRepository implements QuotaReservationRepository {
  readonly reservations = new Map<Uuid, QuotaReservation>();

  insert(reservation: QuotaReservation): Promise<void> {
    this.reservations.set(reservation.id, reservation);
    return Promise.resolve();
  }

  findByMediaId(mediaId: Uuid): Promise<QuotaReservation | null> {
    return Promise.resolve(
      [...this.reservations.values()].find((reservation) => reservation.mediaId === mediaId) ??
        null,
    );
  }

  updateState(reservation: QuotaReservation): Promise<void> {
    this.reservations.set(reservation.id, reservation);
    return Promise.resolve();
  }
}

export interface FakeMediaStorageGatewayOptions {
  /** When set, `getObjectMetadata` returns this for every target instead of `null`. */
  readonly objectMetadata?: MediaObjectMetadata | null;
  readonly uploadSessionTtlMs?: number;
  readonly signedDownloadTtlMs?: number;
  readonly createResumableUploadSessionError?: Error;
}

/** Never touches real Cloud Storage. Records every call it received, for assertions on what target/content-type a command passed. */
export class FakeMediaStorageGateway implements MediaStorageGateway {
  readonly createSessionCalls: {
    target: MediaStorageObjectTarget;
    contentType: string;
    browserOrigin: string | null;
  }[] = [];
  readonly getMetadataCalls: MediaStorageObjectTarget[] = [];
  readonly createSignedUrlCalls: MediaStorageObjectTarget[] = [];

  constructor(private readonly options: FakeMediaStorageGatewayOptions = {}) {}

  createResumableUploadSession(
    target: MediaStorageObjectTarget,
    declaredContentType: string,
    now: Date,
    browserOrigin: string | null,
  ): Promise<MediaResumableUploadSession> {
    this.createSessionCalls.push({ target, contentType: declaredContentType, browserOrigin });
    if (this.options.createResumableUploadSessionError !== undefined) {
      return Promise.reject(this.options.createResumableUploadSessionError);
    }
    const ttl = this.options.uploadSessionTtlMs ?? 3_600_000;
    return Promise.resolve({
      uploadUrl: `https://storage.googleapis.com/upload/${target.bucketName}/${target.objectKey}`,
      expiresAt: new Date(now.getTime() + ttl),
    });
  }

  getObjectMetadata(target: MediaStorageObjectTarget): Promise<MediaObjectMetadata | null> {
    this.getMetadataCalls.push(target);
    return Promise.resolve(this.options.objectMetadata ?? null);
  }

  createSignedDownloadUrl(
    target: MediaStorageObjectTarget,
    now: Date,
  ): Promise<MediaSignedDownloadAccess> {
    this.createSignedUrlCalls.push(target);
    const ttl = this.options.signedDownloadTtlMs ?? 900_000;
    return Promise.resolve({
      url: `https://storage.googleapis.com/${target.bucketName}/${target.objectKey}?signature=fake`,
      expiresAt: new Date(now.getTime() + ttl),
    });
  }
}

/** Records every appended event; never publishes anywhere — the same "record what was called" shape `FakeAuditLogger` below uses. */
export class FakeOutboxAppender implements OutboxAppender {
  readonly events: OutboxEventInput[] = [];

  append(input: OutboxEventInput): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

export class FakeProcessingJobRepository implements ProcessingJobRepository {
  readonly jobs = new Map<Uuid, ProcessingJob>();

  insert(job: ProcessingJob): Promise<void> {
    this.jobs.set(job.id, job);
    return Promise.resolve();
  }

  get(id: Uuid): Promise<ProcessingJob | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  updateState(job: ProcessingJob, expectedRevision: number): Promise<boolean> {
    const existing = this.jobs.get(job.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.jobs.set(job.id, job);
    return Promise.resolve(true);
  }

  listActiveForMedia(mediaId: Uuid): Promise<readonly ProcessingJob[]> {
    const active = [...this.jobs.values()]
      .filter(
        (job) =>
          job.mediaId === mediaId &&
          (job.state === 'requested' || job.state === 'queued' || job.state === 'running'),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(active);
  }
}

/** Answers with a fixed set of reference kinds — empty by default (nothing references the media). */
export class FakeMediaReferenceFinder implements MediaReferenceFinder {
  constructor(public kinds: readonly MediaReferenceKind[] = []) {}

  findReferenceKinds(): Promise<readonly MediaReferenceKind[]> {
    return Promise.resolve(this.kinds);
  }
}

export class FakeAuditLogger implements AuditLogger {
  readonly events: AuditEventInput[] = [];

  record(input: AuditEventInput): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

/**
 * `gardens-mapping`'s own `Membership` is exported through its `public.ts`
 * (added for this module's own use — see that file's own comment); this is
 * a fake repository backing it for tests, the same shape
 * `plants-inventory-test-doubles.ts`'s own `FakeMembershipRepository` uses.
 */
export class FakeMembershipRepository implements MembershipRepository {
  constructor(
    private readonly membership: Membership | null,
    private readonly gardenLifecycleState: GardenLifecycleState = 'active',
  ) {}

  findGardenAccess(): ReturnType<MembershipRepository['findGardenAccess']> {
    return Promise.resolve(
      this.membership === null
        ? null
        : { membership: this.membership, gardenLifecycleState: this.gardenLifecycleState },
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

export function buildMembership(overrides: Partial<Membership> & { gardenId: Uuid }): Membership {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9aff',
    profileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9afe',
    role: 'owner',
    ...overrides,
  };
}

export function authorizationGranting(
  membership: Membership,
  gardenLifecycleState: GardenLifecycleState = 'active',
): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(membership, gardenLifecycleState));
}

export function authorizationDenying(): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(null));
}

interface StoredIdempotencyRecord {
  readonly input: IdempotencyRecordInput;
  readonly responseStatusCode: number;
  readonly responseBody: unknown;
}

/** In-memory stand-in for `KyselyIdempotencyStore`'s real check/save/conflict semantics — the same shape `register-media-record.test.ts`'s own `FakeIdempotencyStore` uses. */
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
        this.matchKey({ actorProfileId, operation, idempotencyKey, requestFingerprint: '' }),
    );

    return Promise.resolve(
      existing === undefined
        ? null
        : { responseStatusCode: existing.responseStatusCode, responseBody: existing.responseBody },
    );
  }
}

/**
 * In-memory stand-in for `KyselyClientMediaEntitlementSource`, keyed
 * identically: `(clientProfileId, mediaRecordId)` -> a grant, or `null`. A
 * test registers exactly the rows the scenario needs via `grant` — no
 * hidden defaulting to "active/active/published", so a test that forgets to
 * set a state up correctly fails loudly rather than passing by accident.
 */
export class FakeClientMediaEntitlementSource implements ClientMediaEntitlementSource {
  private readonly grants = new Map<string, ClientMediaEntitlementGrant>();

  private key(clientProfileId: Uuid, mediaRecordId: Uuid): string {
    return `${clientProfileId}:${mediaRecordId}`;
  }

  grant(clientProfileId: Uuid, mediaRecordId: Uuid, entry: ClientMediaEntitlementGrant): void {
    this.grants.set(this.key(clientProfileId, mediaRecordId), entry);
  }

  findEntitlementGrant(
    clientProfileId: Uuid,
    mediaRecordId: Uuid,
  ): Promise<ClientMediaEntitlementGrant | null> {
    return Promise.resolve(this.grants.get(this.key(clientProfileId, mediaRecordId)) ?? null);
  }
}

export interface MediaFakes {
  readonly media: FakeMediaRepository;
  readonly quotaReservations: FakeQuotaReservationRepository;
  readonly idempotency: FakeIdempotencyStore;
  readonly outbox: FakeOutboxAppender;
  readonly processingJobs: FakeProcessingJobRepository;
  readonly audit: FakeAuditLogger;
  readonly references: FakeMediaReferenceFinder;
}

export function createMediaFakes(): MediaFakes {
  return {
    media: new FakeMediaRepository(),
    quotaReservations: new FakeQuotaReservationRepository(),
    idempotency: new FakeIdempotencyStore(),
    outbox: new FakeOutboxAppender(),
    processingJobs: new FakeProcessingJobRepository(),
    audit: new FakeAuditLogger(),
    references: new FakeMediaReferenceFinder(),
  };
}

/** Not transactional, unlike `KyselyMediaUnitOfWork` — a unit test does not need a real rollback, only the same context shape. */
export class FakeMediaUnitOfWork implements MediaUnitOfWork {
  constructor(private readonly fakes: MediaFakes) {}

  run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T> {
    return work(this.fakes);
  }
}
