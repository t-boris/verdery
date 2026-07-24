import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildMembership,
  createMediaFakes,
  fixedClock,
  FakeMediaStorageGateway,
  FakeMediaUnitOfWork,
  TEST_BUCKETS,
} from './media-test-doubles.js';
import { RegisterMediaUpload } from './register-media-upload.js';
import type { RegisterMediaUploadInput } from './register-media-upload.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-21T09:00:00Z');

const BASE_INPUT: RegisterMediaUploadInput = {
  mediaClass: 'garden_photo',
  displayFilename: 'photo.jpg',
  declaredContentType: 'image/jpeg',
  declaredByteSize: 123_456,
};

function buildUseCase(
  options: {
    role?: 'owner' | 'editor' | 'viewer' | null;
    storage?: FakeMediaStorageGateway;
  } = {},
) {
  const fakes = createMediaFakes();
  const authorization =
    options.role === null
      ? authorizationDenying()
      : authorizationGranting(
          buildMembership({ gardenId: GARDEN_ID, role: options.role ?? 'owner' }),
        );
  const storage = options.storage ?? new FakeMediaStorageGateway();

  const useCase = new RegisterMediaUpload(
    fakes.idempotency,
    new FakeMediaUnitOfWork(fakes),
    authorization,
    storage,
    TEST_BUCKETS,
    fixedClock(NOW),
  );

  return { useCase, fakes, storage };
}

describe('RegisterMediaUpload', () => {
  it('registers the media record, reserves quota, opens an upload session, and returns authorized', async () => {
    const { useCase, fakes, storage } = buildUseCase();

    const result = await useCase.execute(
      GARDEN_ID,
      PROFILE_ID,
      BASE_INPUT,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.media).toMatchObject({
      gardenId: GARDEN_ID,
      uploadedByProfileId: PROFILE_ID,
      mediaClass: 'garden_photo',
      uploadState: 'authorized',
      revision: 2,
    });
    expect(result.uploadUrl).toContain('test-user-media');
    expect(result.uploadUrlExpiresAt).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());

    expect(fakes.media.records.size).toBe(1);
    const stored = [...fakes.media.records.values()][0];
    expect(stored?.bucketName).toBe('test-user-media');
    expect(stored?.objectKey).toContain(stored?.id);

    expect(fakes.quotaReservations.reservations.size).toBe(1);
    const reservation = [...fakes.quotaReservations.reservations.values()][0];
    expect(reservation).toMatchObject({
      scopeKind: 'garden',
      scopeGardenId: GARDEN_ID,
      mediaId: stored?.id,
      reservedBytes: 123_456,
      state: 'reserved',
    });

    expect(storage.createSessionCalls).toHaveLength(1);
    expect(storage.createSessionCalls[0]).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('routes raw_capture uploads to the raw-capture bucket', async () => {
    const { useCase, fakes } = buildUseCase();

    await useCase.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...BASE_INPUT, mediaClass: 'raw_capture', displayFilename: 'scan.mov' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
    );

    const stored = [...fakes.media.records.values()][0];
    expect(stored?.bucketName).toBe('test-raw-capture');
    expect(stored?.sensitivityClassification).toBe('restricted');
  });

  it('conceals a garden the caller has no membership on as notFound', async () => {
    const { useCase } = buildUseCase({ role: null });

    await expect(
      useCase.execute(GARDEN_ID, PROFILE_ID, BASE_INPUT, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11'),
    ).rejects.toMatchObject({ category: 'notFound' });
  });

  it('forbids a viewer role — registration requires editGardenContent', async () => {
    const { useCase } = buildUseCase({ role: 'viewer' });

    await expect(
      useCase.execute(GARDEN_ID, PROFILE_ID, BASE_INPUT, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12'),
    ).rejects.toMatchObject({ category: 'forbidden' });
  });

  it('permits an editor role, not only owner', async () => {
    const { useCase } = buildUseCase({ role: 'editor' });

    const result = await useCase.execute(
      GARDEN_ID,
      PROFILE_ID,
      BASE_INPUT,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
    );
    expect(result.media.uploadState).toBe('authorized');
  });

  it('translates a storage gateway failure into DependencyUnavailableError', async () => {
    const storage = new FakeMediaStorageGateway({
      createResumableUploadSessionError: new Error('gcs unavailable'),
    });
    const { useCase } = buildUseCase({ storage });

    // `FakeMediaUnitOfWork` is deliberately non-transactional (see its own
    // doc comment) — it cannot demonstrate a real rollback. That is
    // `tests/integration/media-upload-flow.test.ts`'s job, against a real
    // Postgres transaction. This test only proves the error itself
    // propagates as the correct typed application error.
    await expect(
      useCase.execute(GARDEN_ID, PROFILE_ID, BASE_INPUT, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14'),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('replays the same idempotency key without opening a second upload session', async () => {
    const { useCase, storage } = buildUseCase();
    const key = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a15';

    const first = await useCase.execute(GARDEN_ID, PROFILE_ID, BASE_INPUT, key);
    const replay = await useCase.execute(GARDEN_ID, PROFILE_ID, BASE_INPUT, key);

    expect(replay).toEqual(first);
    expect(storage.createSessionCalls).toHaveLength(1);
  });
});
