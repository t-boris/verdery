import { MEDIA_PROCESSING_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import { authorizeMediaUpload } from '../domain/media-lifecycle.js';
import { registerMediaRecord } from '../domain/media-record.js';
import type { MediaRecord } from '../domain/media-record.js';
import { reserveMediaQuota } from '../domain/quota-reservation.js';
import { CompleteMediaUpload } from './complete-media-upload.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildMembership,
  createMediaFakes,
  fixedClock,
  FakeMediaStorageGateway,
  FakeMediaUnitOfWork,
} from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const NOW = new Date('2026-07-21T09:00:00Z');
const BUCKET = 'test-user-media';
const OBJECT_KEY = 'ab/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';

function authorizedRecord(): MediaRecord {
  const registered = registerMediaRecord(
    MEDIA_ID,
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
  );
  return authorizeMediaUpload(registered, BUCKET, OBJECT_KEY, NOW);
}

function buildUseCase(
  options: {
    role?: 'owner' | 'editor' | 'viewer' | null;
    metadata?: { contentType: string; sizeBytes: number } | null;
    seed?: MediaRecord;
  } = {},
) {
  const fakes = createMediaFakes();
  const record = options.seed ?? authorizedRecord();
  fakes.media.records.set(record.id, record);
  // `FakeQuotaReservationRepository.insert` mutates its Map synchronously
  // before returning an already-resolved promise, so this setup helper does
  // not need to be async itself to observe the effect — the promise is
  // deliberately discarded, not awaited.
  void fakes.quotaReservations.insert(
    reserveMediaQuota(
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a20',
      'garden',
      GARDEN_ID,
      null,
      record.id,
      record.declaredByteSize,
      NOW,
    ),
  );

  const authorization =
    options.role === null
      ? authorizationDenying()
      : authorizationGranting(
          buildMembership({ gardenId: GARDEN_ID, role: options.role ?? 'owner' }),
        );
  const storage = new FakeMediaStorageGateway({
    objectMetadata:
      options.metadata === undefined
        ? { contentType: 'image/jpeg', sizeBytes: 123_456 }
        : options.metadata,
  });

  const useCase = new CompleteMediaUpload(
    fakes.idempotency,
    new FakeMediaUnitOfWork(fakes),
    authorization,
    storage,
    fixedClock(NOW),
  );

  return { useCase, fakes, storage, record };
}

describe('CompleteMediaUpload', () => {
  it('resolves to available when real object metadata matches the declared content type and byte size', async () => {
    const { useCase, fakes } = buildUseCase();

    const result = await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a21',
    );

    expect(result.uploadState).toBe('available');
    expect(result.verifiedContentType).toBe('image/jpeg');
    expect(result.verifiedByteSize).toBe(123_456);

    const reservation = [...fakes.quotaReservations.reservations.values()][0];
    expect(reservation?.state).toBe('committed');
  });

  it('appends a media.processing_requested outbox event exactly once when it resolves to available', async () => {
    const { useCase, fakes } = buildUseCase();

    const result = await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a30',
    );

    expect(result.uploadState).toBe('available');
    expect(fakes.outbox.events).toHaveLength(1);
    expect(fakes.outbox.events[0]).toMatchObject({
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      aggregateType: 'media_record',
      aggregateId: MEDIA_ID,
      payload: {
        mediaId: MEDIA_ID,
        gardenId: GARDEN_ID,
        mediaClass: 'garden_photo',
        bucketName: BUCKET,
        objectKey: OBJECT_KEY,
        contentType: 'image/jpeg',
        byteSize: 123_456,
      },
    });
  });

  it('resolves to rejected on a declared/actual byte-size mismatch, and releases the quota reservation', async () => {
    const { useCase, fakes } = buildUseCase({
      metadata: { contentType: 'image/jpeg', sizeBytes: 999 },
    });

    const result = await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a22',
    );

    expect(result.uploadState).toBe('rejected');
    expect(result.verifiedContentType).toBeNull();
    const reservation = [...fakes.quotaReservations.reservations.values()][0];
    expect(reservation?.state).toBe('released');
    // No processing was ever triggered for a rejected upload.
    expect(fakes.outbox.events).toHaveLength(0);
  });

  it('resolves to rejected on a declared/actual content-type mismatch', async () => {
    const { useCase } = buildUseCase({
      metadata: { contentType: 'image/heic', sizeBytes: 123_456 },
    });

    const result = await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a23',
    );

    expect(result.uploadState).toBe('rejected');
  });

  it('resolves to rejected when the object was never uploaded (metadata absent)', async () => {
    const { useCase } = buildUseCase({ metadata: null });

    const result = await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a24',
    );

    expect(result.uploadState).toBe('rejected');
  });

  it('is idempotent under a duplicate completion notification: a second call against an already-available record replays it without re-verifying', async () => {
    const { useCase, storage, fakes } = buildUseCase();

    await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a25',
    );
    const second = await useCase.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      2,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a26',
    );

    expect(second.uploadState).toBe('available');
    // Only the first call actually read object metadata; the duplicate
    // notification short-circuited before touching the gateway again.
    expect(storage.getMetadataCalls).toHaveLength(1);
    // ...and only the first call appended the processing-requested event.
    expect(fakes.outbox.events).toHaveLength(1);
  });

  it('rejects verifying a record that is not yet authorized (still registered)', async () => {
    const registered = registerMediaRecord(
      MEDIA_ID,
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
    );
    const { useCase } = buildUseCase({ seed: registered });

    await expect(
      useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID, 1, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a27'),
    ).rejects.toMatchObject({ category: 'conflict' });
  });

  it('rejects a stale expectedRevision', async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID, 99, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a28'),
    ).rejects.toMatchObject({ category: 'staleRevision' });
  });

  it('conceals a media record scoped to a different garden as notFound', async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute(
        OTHER_GARDEN_ID,
        MEDIA_ID,
        PROFILE_ID,
        2,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a29',
      ),
    ).rejects.toMatchObject({ category: 'notFound' });
  });

  it('forbids a viewer role — completion requires editGardenContent', async () => {
    const { useCase } = buildUseCase({ role: 'viewer' });

    await expect(
      useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID, 2, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a2a'),
    ).rejects.toMatchObject({ category: 'forbidden' });
  });
});
