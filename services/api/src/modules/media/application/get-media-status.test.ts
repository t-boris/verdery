import { describe, expect, it } from 'vitest';
import type { MediaRecord } from '../domain/media-record.js';
import { registerMediaRecord } from '../domain/media-record.js';
import { GetMediaStatus } from './get-media-status.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildMembership,
} from './media-test-doubles.js';
import { FakeMediaRepository } from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const NOW = new Date('2026-07-21T09:00:00Z');

function seededRepository(): FakeMediaRepository {
  const repository = new FakeMediaRepository();
  const record = registerMediaRecord(
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
  repository.records.set(record.id, record);
  return repository;
}

describe('GetMediaStatus', () => {
  it('returns the media record for any garden role that can view the garden', async () => {
    const repository = seededRepository();
    const useCase = new GetMediaStatus(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID);
    expect(result.id).toBe(MEDIA_ID);
    expect(result.uploadState).toBe('registered');
    // A record processing has not touched carries an (empty) derivatives
    // array — see `Media.derivatives`' contract description.
    expect(result.derivatives).toEqual([]);
  });

  it('resolves the record`s available display derivatives, latest transformation version per kind, tiles excluded (P6-PLAN-01)', async () => {
    const repository = seededRepository();
    const original = repository.records.get(MEDIA_ID);
    if (original === undefined) {
      throw new Error('seed record missing');
    }
    const derivativeBase: MediaRecord = {
      ...original,
      mediaClass: 'derived_preview',
      uploadState: 'available',
      processingState: null,
      derivedFromMediaId: MEDIA_ID,
      transformationVersion: 1,
    };
    const staleThumbnail: MediaRecord = {
      ...derivativeBase,
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01',
      derivativeKind: 'thumbnail',
    };
    const currentThumbnail: MediaRecord = {
      ...derivativeBase,
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
      derivativeKind: 'thumbnail',
      transformationVersion: 2,
    };
    const screenPreview: MediaRecord = {
      ...derivativeBase,
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
      derivativeKind: 'screen_preview',
    };
    const tile: MediaRecord = {
      ...derivativeBase,
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a04',
      derivativeKind: 'tile',
      tileZoomLevel: 0,
      tileX: 0,
      tileY: 0,
    };
    for (const record of [staleThumbnail, currentThumbnail, screenPreview, tile]) {
      repository.records.set(record.id, record);
    }

    const useCase = new GetMediaStatus(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID);
    expect(result.derivatives).toEqual(
      expect.arrayContaining([
        { derivativeKind: 'thumbnail', mediaId: currentThumbnail.id },
        { derivativeKind: 'screen_preview', mediaId: screenPreview.id },
      ]),
    );
    expect(result.derivatives).toHaveLength(2);
  });

  it('conceals a media record scoped to a different garden as notFound', async () => {
    const repository = seededRepository();
    const useCase = new GetMediaStatus(
      repository,
      authorizationGranting(buildMembership({ gardenId: OTHER_GARDEN_ID, role: 'owner' })),
    );

    await expect(useCase.execute(OTHER_GARDEN_ID, MEDIA_ID, PROFILE_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
  });

  it('conceals a garden the caller has no membership on as notFound', async () => {
    const repository = seededRepository();
    const useCase = new GetMediaStatus(repository, authorizationDenying());

    await expect(useCase.execute(GARDEN_ID, MEDIA_ID, PROFILE_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
  });

  it('returns notFound for a media id that does not exist', async () => {
    const repository = new FakeMediaRepository();
    const useCase = new GetMediaStatus(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'owner' })),
    );

    await expect(
      useCase.execute(GARDEN_ID, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9aaa', PROFILE_ID),
    ).rejects.toMatchObject({ category: 'notFound' });
  });
});
