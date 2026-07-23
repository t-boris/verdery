import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../../../platform/errors/application-error.js';
import type {
  IdempotencyCheck,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MediaRecord } from '../domain/media-record.js';
import type { MediaRepository } from './media-repository.js';
import type { MediaTransactionContext, MediaUnitOfWork } from './media-unit-of-work.js';
import { RegisterMediaRecord } from './register-media-record.js';

const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-21T09:00:00Z');

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
  it('validates, trims, and registers a new media record', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );

    const result = await useCase.execute(
      PROFILE_ID,
      '  gs://verdery-media/example.jpg  ',
      '  image/jpeg  ',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
    );

    expect(result).toMatchObject({
      storageReference: 'gs://verdery-media/example.jpg',
      mimeType: 'image/jpeg',
      uploadedByProfileId: PROFILE_ID,
      createdAt: NOW.toISOString(),
    });
    expect(media.records).toHaveLength(1);
    expect(media.records[0]?.id).toBe(result.id);
  });

  it('rejects a blank mimeType without inserting anything', async () => {
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
        'gs://verdery-media/example.jpg',
        '   ',
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(media.records).toHaveLength(0);
  });

  it('rejects a blank storageReference without inserting anything', async () => {
    const media = new FakeMediaRepository();
    const idempotency = new FakeIdempotencyStore();
    const useCase = new RegisterMediaRecord(
      idempotency,
      new FakeMediaUnitOfWork(media, idempotency),
      fixedClock(),
    );

    await expect(
      useCase.execute(PROFILE_ID, '   ', 'image/jpeg', '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f'),
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
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';

    const first = await useCase.execute(
      PROFILE_ID,
      'gs://verdery-media/one.jpg',
      'image/jpeg',
      key,
    );
    const replay = await useCase.execute(
      PROFILE_ID,
      'gs://verdery-media/one.jpg',
      'image/jpeg',
      key,
    );
    expect(replay).toEqual(first);
    expect(media.records).toHaveLength(1);

    await expect(
      useCase.execute(PROFILE_ID, 'gs://verdery-media/two.jpg', 'image/png', key),
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
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';

    // Simulates another concurrent request committing its own `save` between
    // this request's `check` (finding nothing) and this request's own `save`.
    const winnerResult = {
      id: 'winner-media-id',
      storageReference: 'gs://verdery-media/winner.jpg',
      mimeType: 'image/jpeg',
      uploadedByProfileId: PROFILE_ID,
      createdAt: NOW.toISOString(),
    };
    idempotency.saveError = uniqueViolation();
    const checkSpy = vi
      .spyOn(idempotency, 'check')
      .mockImplementationOnce(() => Promise.resolve({ kind: 'new' }))
      .mockImplementationOnce(() =>
        Promise.resolve({ kind: 'replay', responseStatusCode: 201, responseBody: winnerResult }),
      );

    const result = await useCase.execute(
      PROFILE_ID,
      'gs://verdery-media/example.jpg',
      'image/jpeg',
      key,
    );

    expect(result).toEqual(winnerResult);
    checkSpy.mockRestore();
  });
});
