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
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { Membership, MembershipRepository } from '../../gardens-mapping/public.js';
import type { MediaRecord } from '../domain/media-record.js';
import type { ProcessingJob } from '../domain/processing-job.js';
import type { QuotaReservation } from '../domain/quota-reservation.js';
import type { ProcessingJobRepository } from './processing-job-repository.js';
import type {
  MediaObjectMetadata,
  MediaResumableUploadSession,
  MediaSignedDownloadAccess,
  MediaStorageGateway,
  MediaStorageObjectTarget,
} from './media-storage-gateway.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';
import type { MediaRepository } from './media-repository.js';
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

export class FakeMediaRepository implements MediaRepository {
  readonly records = new Map<Uuid, MediaRecord>();

  insert(record: MediaRecord): Promise<void> {
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  get(id: Uuid): Promise<MediaRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  update(record: MediaRecord, expectedRevision: number): Promise<boolean> {
    const existing = this.records.get(record.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.records.set(record.id, record);
    return Promise.resolve(true);
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
  readonly createSessionCalls: { target: MediaStorageObjectTarget; contentType: string }[] = [];
  readonly getMetadataCalls: MediaStorageObjectTarget[] = [];
  readonly createSignedUrlCalls: MediaStorageObjectTarget[] = [];

  constructor(private readonly options: FakeMediaStorageGatewayOptions = {}) {}

  createResumableUploadSession(
    target: MediaStorageObjectTarget,
    declaredContentType: string,
    now: Date,
  ): Promise<MediaResumableUploadSession> {
    this.createSessionCalls.push({ target, contentType: declaredContentType });
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
  constructor(private readonly membership: Membership | null) {}

  findActiveMembership(): ReturnType<MembershipRepository['findActiveMembership']> {
    return Promise.resolve(this.membership);
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): ReturnType<MembershipRepository['listMembershipsForProfile']> {
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

export function authorizationGranting(membership: Membership): GardenAuthorization {
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

export interface MediaFakes {
  readonly media: FakeMediaRepository;
  readonly quotaReservations: FakeQuotaReservationRepository;
  readonly idempotency: FakeIdempotencyStore;
  readonly outbox: FakeOutboxAppender;
  readonly processingJobs: FakeProcessingJobRepository;
}

export function createMediaFakes(): MediaFakes {
  return {
    media: new FakeMediaRepository(),
    quotaReservations: new FakeQuotaReservationRepository(),
    idempotency: new FakeIdempotencyStore(),
    outbox: new FakeOutboxAppender(),
    processingJobs: new FakeProcessingJobRepository(),
  };
}

/** Not transactional, unlike `KyselyMediaUnitOfWork` — a unit test does not need a real rollback, only the same context shape. */
export class FakeMediaUnitOfWork implements MediaUnitOfWork {
  constructor(private readonly fakes: MediaFakes) {}

  run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T> {
    return work(this.fakes);
  }
}
