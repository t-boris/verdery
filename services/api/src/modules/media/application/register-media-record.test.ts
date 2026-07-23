import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../../../platform/errors/application-error.js';
import type {
  IdempotencyCheck,
  IdempotencyLookupResult,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MediaRecord } from '../domain/media-record.js';
import type { MediaRepository } from './media-repository.js';
import type { MediaTransactionContext, MediaUnitOfWork } from './media-unit-of-work.js';
import { RegisterMediaRecord } from './register-media-record.js';
import type { RegisterMediaRecordInput } from './register-media-record.js';

const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-21T09:00:00Z');

const BASE_INPUT: RegisterMediaRecordInput = {
  gardenId: GARDEN_ID,
  mediaClass: 'garden_photo',
  displayFilename: 'photo.jpg',
  declaredContentType: 'image/jpeg',
  declaredByteSize: 123_456,
};

function fixedClock(): Clock {
  return { now: () => NOW };
}

class FakeMediaRepository implements MediaRepository {
  readonly records: MediaRecord[] = [];

  insert(record: MediaRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }

  get(id: string): Promise<MediaRecord | null> {
    return Promise.resolve(this.records.find((record) => record.id === id) ?? null);
  }
}

interface StoredIdempotencyRecord {
  readonly input: IdempotencyRecordInput;
  readonly responseStatusCode: number;
  readonly responseBody: unknown;
}

/** In-memory stand-in for `KyselyIdempotencyStore`'s real check/save/conflict semantics. */
class FakeIdempotencyStore implements IdempotencyStore {
  readonly saved: StoredIdempotencyRecord[] = [];
  saveError: Error | null = null;

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
    if (this.saveError !== null) {
      const error = this.saveError;
      this.saveError = null;
      return Promise.reject(error);
    }

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

/** Not transactional, unlike `KyselyMediaUnitOfWork` — a unit test does not need a real rollback, only the same context shape. */
class FakeMediaUnitOfWork implements MediaUnitOfWork {
  constructor(
    private readonly media: MediaRepository,
    private readonly idempotency: IdempotencyStore,
  ) {}

  run<T>(work: (context: MediaTransactionContext) => Promise<T>): Promise<T> {
    return work({ media: this.media, idempotency: this.idempotency });
  }
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

describe('RegisterMediaRecord', () => {
  it('validates, normalizes, and registers a new media record with the documented defaults', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );

    const result = await useCase.execute(
      PROFILE_ID,
      {
        ...BASE_INPUT,
        displayFilename: '  ../../photo.jpg  ',
        declaredContentType: '  image/jpeg  ',
      },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result).toMatchObject({
      gardenId: GARDEN_ID,
      uploadedByProfileId: PROFILE_ID,
      mediaClass: 'garden_photo',
      displayFilename: 'photo.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 123_456,
      uploadState: 'registered',
      processingState: null,
      sensitivityClassification: 'standard',
      revision: 1,
      createdAt: NOW.toISOString(),
    });
    expect(media.records).toHaveLength(1);
    expect(media.records[0]?.id).toBe(result.id);
  });

  it('accepts an omitted gardenId as null', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );

    const { gardenId, ...withoutGardenId } = BASE_INPUT;
    void gardenId;
    const result = await useCase.execute(
      PROFILE_ID,
      withoutGardenId,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(result.gardenId).toBeNull();
  });

  it('rejects a blank displayFilename without inserting anything', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );

    await expect(
      useCase.execute(
        PROFILE_ID,
        { ...BASE_INPUT, displayFilename: '   ' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(media.records).toHaveLength(0);
  });

  it('rejects a blank declaredContentType or a non-positive declaredByteSize without inserting anything', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );

    await expect(
      useCase.execute(
        PROFILE_ID,
        { ...BASE_INPUT, declaredContentType: '   ' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCase.execute(
        PROFILE_ID,
        { ...BASE_INPUT, declaredByteSize: 0 },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(media.records).toHaveLength(0);
  });

  it('replays the same idempotency key without inserting a second record, and rejects a reused key with a different body', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13';

    const first = await useCase.execute(PROFILE_ID, BASE_INPUT, key);
    const replay = await useCase.execute(PROFILE_ID, BASE_INPUT, key);
    expect(replay).toEqual(first);
    expect(media.records).toHaveLength(1);

    await expect(
      useCase.execute(PROFILE_ID, { ...BASE_INPUT, displayFilename: 'other.jpg' }, key),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("recovers from a concurrent duplicate save by returning the winner's already-saved result", async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14';

    // Simulates another concurrent request committing its own `save` between
    // this request's `check` (finding nothing) and this request's own `save`.
    const winnerResult = {
      id: 'winner-media-id',
      gardenId: GARDEN_ID,
      uploadedByProfileId: PROFILE_ID,
      mediaClass: 'garden_photo',
      displayFilename: 'photo.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 123_456,
      uploadState: 'registered',
      createdAt: NOW.toISOString(),
    };
    idempotency.saveError = uniqueViolation();
    const checkSpy = vi
      .spyOn(idempotency, 'check')
      .mockImplementationOnce(() => Promise.resolve({ kind: 'new' }))
      .mockImplementationOnce(() =>
        Promise.resolve({ kind: 'replay', responseStatusCode: 201, responseBody: winnerResult }),
      );

    const result = await useCase.execute(PROFILE_ID, BASE_INPUT, key);

    expect(result).toEqual(winnerResult);
    checkSpy.mockRestore();
  });
});
