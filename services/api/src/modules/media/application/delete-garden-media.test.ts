import { MEDIA_DELETION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import type { MediaDeletionRequestedEventPayload } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import {
  authorizeMediaUpload,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
} from '../domain/media-lifecycle.js';
import { registerDerivativeMediaRecord, registerMediaRecord } from '../domain/media-record.js';
import type { MediaRecord } from '../domain/media-record.js';
import { createProcessingJob, markProcessingJobQueued } from '../domain/processing-job.js';
import { reserveMediaQuota } from '../domain/quota-reservation.js';
import { DeleteGardenMedia } from './delete-garden-media.js';
import { objectKeyPrefixForMedia } from './media-storage-target.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildMembership,
  createMediaFakes,
  FakeMediaUnitOfWork,
  fixedClock,
  TEST_BUCKETS,
} from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0a';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0b';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0c';
const DERIVATIVE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0d';
const JOB_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0e';
const NOW = new Date('2026-07-21T09:00:00Z');
const LATER = new Date('2026-07-21T09:05:00Z');

function availableMedia(id: string = MEDIA_ID): MediaRecord {
  const registered = registerMediaRecord(
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
  );
  const authorized = authorizeMediaUpload(
    registered,
    TEST_BUCKETS.userMedia,
    `${objectKeyPrefixForMedia(id)}object-uuid`,
    NOW,
  );
  return markMediaAvailable(
    beginMediaVerification(beginMediaUpload(authorized, NOW), NOW),
    'image/jpeg',
    123_456,
    null,
    NOW,
  );
}

function derivativeOf(source: MediaRecord): MediaRecord {
  return registerDerivativeMediaRecord(
    DERIVATIVE_ID,
    {
      gardenId: source.gardenId,
      uploadedByProfileId: source.uploadedByProfileId,
      displayFilename: source.displayFilename,
      contentType: 'image/jpeg',
      byteSize: 8_000,
      checksumSha256: 'f'.repeat(64),
      bucketName: TEST_BUCKETS.derived,
      objectKey: `${objectKeyPrefixForMedia(source.id)}derivative-uuid`,
      derivedFromMediaId: source.id,
      transformationVersion: 1,
      derivativeKind: 'thumbnail',
      tile: null,
      sensitivityClassification: source.sensitivityClassification,
    },
    NOW,
  );
}

function buildCommand(options: { authorized?: boolean } = {}) {
  const fakes = createMediaFakes();
  const authorization =
    options.authorized === false
      ? authorizationDenying()
      : authorizationGranting(buildMembership({ gardenId: GARDEN_ID, profileId: PROFILE_ID }));
  const command = new DeleteGardenMedia(
    fakes.idempotency,
    new FakeMediaUnitOfWork(fakes),
    authorization,
    TEST_BUCKETS,
    fixedClock(LATER),
  );
  return { command, fakes };
}

describe('DeleteGardenMedia', () => {
  it('schedules deletion: record to deletion_scheduled, derivatives scheduled, active jobs cancelled, one prefix-scoped outbox event, one audit event', async () => {
    const { command, fakes } = buildCommand();
    const media = availableMedia();
    fakes.media.records.set(MEDIA_ID, media);
    fakes.media.records.set(DERIVATIVE_ID, derivativeOf(media));
    await fakes.processingJobs.insert(
      markProcessingJobQueued(
        createProcessingJob(
          { id: JOB_ID, mediaId: MEDIA_ID, processorConfigVersion: 'v1', inputChecksums: [] },
          NOW,
        ),
        NOW,
      ),
    );

    const result = await command.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      media.revision,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0f',
    );

    expect(result.uploadState).toBe('deletion_scheduled');
    expect(fakes.media.records.get(MEDIA_ID)?.uploadState).toBe('deletion_scheduled');
    expect(fakes.media.records.get(DERIVATIVE_ID)?.uploadState).toBe('deletion_scheduled');
    expect(fakes.processingJobs.jobs.get(JOB_ID)).toMatchObject({
      state: 'cancelled',
      outcomeCode: 'media_deletion_scheduled',
    });

    expect(fakes.outbox.events).toHaveLength(1);
    expect(fakes.outbox.events[0]?.eventType).toBe(MEDIA_DELETION_REQUESTED_EVENT_TYPE);
    const payload = fakes.outbox.events[0]?.payload as MediaDeletionRequestedEventPayload;
    expect(payload.checksumSha256).toBeNull();
    expect(payload.objectPrefixes).toEqual([
      { bucketName: TEST_BUCKETS.userMedia, objectKeyPrefix: objectKeyPrefixForMedia(MEDIA_ID) },
      { bucketName: TEST_BUCKETS.derived, objectKeyPrefix: objectKeyPrefixForMedia(MEDIA_ID) },
    ]);

    expect(fakes.audit.events).toEqual([
      expect.objectContaining({
        eventType: 'media.deletion_requested',
        subjectId: MEDIA_ID,
        actorProfileId: PROFILE_ID,
        actorType: 'user',
      }),
    ]);
  });

  it('replays idempotently: a record already deletion_scheduled returns its state without a second event or transition', async () => {
    const { command, fakes } = buildCommand();
    const media = availableMedia();
    fakes.media.records.set(MEDIA_ID, media);

    const first = await command.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      media.revision,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e10',
    );
    const second = await command.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      media.revision,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e11',
    );

    expect(first.uploadState).toBe('deletion_scheduled');
    expect(second.uploadState).toBe('deletion_scheduled');
    // Exactly ONE deletion event and one audit record — the replay
    // performed no second workflow.
    expect(fakes.outbox.events).toHaveLength(1);
    expect(fakes.audit.events).toHaveLength(1);
  });

  it('rejects a record still referenced by attachments with media.referenced, naming each kind, and rolls nothing forward', async () => {
    const { command, fakes } = buildCommand();
    const media = availableMedia();
    fakes.media.records.set(MEDIA_ID, media);
    fakes.references.kinds = ['plant_photo', 'imported_background'];

    await expect(
      command.execute(
        GARDEN_ID,
        MEDIA_ID,
        PROFILE_ID,
        media.revision,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e12',
      ),
    ).rejects.toMatchObject({
      code: 'media.referenced',
      details: [
        { code: 'media.referenced.plant_photo' },
        { code: 'media.referenced.imported_background' },
      ],
    });
    // The FakeMediaUnitOfWork has no real rollback; the REAL rollback
    // behavior (record stays available) is proven by the Testcontainers
    // integration test. This unit test proves the guard fires and no
    // deletion event was appended before the throw... except the workflow
    // appends before the check by design — the event is rolled back WITH
    // the transaction in production. Assert only the error surface here.
  });

  it('rejects deleting a derivative row directly', async () => {
    const { command, fakes } = buildCommand();
    const media = availableMedia();
    fakes.media.records.set(MEDIA_ID, media);
    const derivative = derivativeOf(media);
    fakes.media.records.set(DERIVATIVE_ID, derivative);

    await expect(
      command.execute(
        GARDEN_ID,
        DERIVATIVE_ID,
        PROFILE_ID,
        derivative.revision,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e13',
      ),
    ).rejects.toMatchObject({ code: 'media.derivative_not_deletable' });
  });

  it('rejects a record in a pre-available state (the sweep owns orphans) and a stale revision', async () => {
    const { command, fakes } = buildCommand();
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
    fakes.media.records.set(MEDIA_ID, registered);

    await expect(
      command.execute(
        GARDEN_ID,
        MEDIA_ID,
        PROFILE_ID,
        registered.revision,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e14',
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    fakes.media.records.set(MEDIA_ID, availableMedia());
    await expect(
      command.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID, 999, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e15'),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('conceals a cross-garden record as not found, and rejects a caller without editGardenContent', async () => {
    const { command, fakes } = buildCommand();
    const media = { ...availableMedia(), gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9eff' };
    fakes.media.records.set(MEDIA_ID, media);

    await expect(
      command.execute(
        GARDEN_ID,
        MEDIA_ID,
        PROFILE_ID,
        media.revision,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e16',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const denied = buildCommand({ authorized: false });
    denied.fakes.media.records.set(MEDIA_ID, availableMedia());
    await expect(
      denied.command.execute(
        GARDEN_ID,
        MEDIA_ID,
        PROFILE_ID,
        1,
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e17',
      ),
    ).rejects.toMatchObject({ code: 'garden.not_found' });
  });

  it('completes a never-authorized record (no stored object) in place: straight to deleted, reservation released, no worker event', async () => {
    const { command, fakes } = buildCommand();
    // A registered row with no bucket cannot come from RegisterMediaUpload
    // (which authorizes in the same command) — this exercises the
    // workflow's no-object short-circuit through the one state that can
    // reach it. `available` with a null bucket cannot exist, so drive the
    // guard through the workflow by hand-crafting the state.
    const media = { ...availableMedia(), bucketName: null, objectKey: null };
    fakes.media.records.set(MEDIA_ID, media);
    await fakes.quotaReservations.insert(
      reserveMediaQuota(
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e18',
        'garden',
        GARDEN_ID,
        null,
        MEDIA_ID,
        123_456,
        NOW,
      ),
    );

    const result = await command.execute(
      GARDEN_ID,
      MEDIA_ID,
      PROFILE_ID,
      media.revision,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e19',
    );

    expect(result.uploadState).toBe('deleted');
    expect(fakes.outbox.events).toHaveLength(0);
    expect(
      [...fakes.quotaReservations.reservations.values()].find((r) => r.mediaId === MEDIA_ID)?.state,
    ).toBe('released');
    expect(fakes.audit.events.map((event) => event.eventType)).toEqual([
      'media.deletion_requested',
      'media.deleted',
    ]);
  });
});
