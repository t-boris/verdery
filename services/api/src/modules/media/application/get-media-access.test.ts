import { describe, expect, it } from 'vitest';
import {
  authorizeMediaUpload,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
} from '../domain/media-lifecycle.js';
import { registerMediaRecord } from '../domain/media-record.js';
import type { MediaClass, MediaRecord } from '../domain/media-record.js';
import { GetMediaAccess } from './get-media-access.js';
import {
  authorizationGranting,
  buildMembership,
  FakeAuditLogger,
  FakeMediaRepository,
  FakeMediaStorageGateway,
  fixedClock,
} from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const NOW = new Date('2026-07-21T09:00:00Z');
const BUCKET = 'test-user-media';
const OBJECT_KEY = 'ab/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';

function availableRecord(mediaClass: MediaClass): MediaRecord {
  const registered = registerMediaRecord(
    MEDIA_ID,
    GARDEN_ID,
    PROFILE_ID,
    mediaClass,
    'photo.jpg',
    'image/jpeg',
    123_456,
    null,
    null,
    null,
    null,
    NOW,
  );
  const authorized = authorizeMediaUpload(registered, BUCKET, OBJECT_KEY, NOW);
  const uploading = beginMediaUpload(authorized, NOW);
  const verifying = beginMediaVerification(uploading, NOW);
  return markMediaAvailable(verifying, 'image/jpeg', 123_456, null, NOW);
}

function buildUseCase(record: MediaRecord, role: 'owner' | 'editor' | 'viewer') {
  const repository = new FakeMediaRepository();
  repository.records.set(record.id, record);
  const auditLogger = new FakeAuditLogger();
  const storage = new FakeMediaStorageGateway();

  const useCase = new GetMediaAccess(
    repository,
    authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role })),
    storage,
    auditLogger,
    fixedClock(NOW),
  );

  return { useCase, storage, auditLogger };
}

describe('GetMediaAccess', () => {
  it('returns a short-lived signed URL for available, standard-classified media', async () => {
    const { useCase, storage } = buildUseCase(availableRecord('garden_photo'), 'owner');

    const result = await useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID);

    expect(result.url).toContain(BUCKET);
    expect(result.expiresAt).toBe(new Date(NOW.getTime() + 900_000).toISOString());
    expect(storage.createSignedUrlCalls).toHaveLength(1);
  });

  it('rejects access before the media reaches available', async () => {
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
    const { useCase } = buildUseCase(registered, 'owner');

    await expect(useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID)).rejects.toMatchObject({
      category: 'conflict',
    });
  });

  it('allows a viewer to access ordinary standard-classified media', async () => {
    const { useCase } = buildUseCase(availableRecord('garden_photo'), 'viewer');
    await expect(useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID)).resolves.toBeDefined();
  });

  it('forbids a viewer from accessing restricted (raw_capture) media', async () => {
    const { useCase, storage } = buildUseCase(availableRecord('raw_capture'), 'viewer');

    await expect(useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID)).rejects.toMatchObject({
      category: 'forbidden',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('allows an editor to access restricted (raw_capture) media', async () => {
    const { useCase } = buildUseCase(availableRecord('raw_capture'), 'editor');
    await expect(useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID)).resolves.toBeDefined();
  });

  it('records a sensitive-access audit event only for restricted-classified media', async () => {
    const { useCase: standardUseCase, auditLogger: standardAuditLogger } = buildUseCase(
      availableRecord('garden_photo'),
      'owner',
    );
    await standardUseCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID);
    expect(standardAuditLogger.events).toHaveLength(0);

    const { useCase: restrictedUseCase, auditLogger: restrictedAuditLogger } = buildUseCase(
      availableRecord('raw_capture'),
      'owner',
    );
    await restrictedUseCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID);
    expect(restrictedAuditLogger.events).toHaveLength(1);
    expect(restrictedAuditLogger.events[0]).toMatchObject({
      eventType: 'media.restricted_access_granted',
      subjectId: MEDIA_ID,
      actorProfileId: PROFILE_ID,
    });
  });
});
