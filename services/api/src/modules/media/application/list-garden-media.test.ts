import { describe, expect, it } from 'vitest';
import type { MediaClass, MediaRecord } from '../domain/media-record.js';
import { registerMediaRecord } from '../domain/media-record.js';
import { ListGardenMedia } from './list-garden-media.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildMembership,
  FakeMediaRepository,
} from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';

function record(
  id: string,
  mediaClass: MediaClass,
  createdAt: Date,
  gardenId: string = GARDEN_ID,
): MediaRecord {
  return registerMediaRecord(
    id,
    gardenId,
    PROFILE_ID,
    mediaClass,
    mediaClass === 'imported_plan' ? 'plan.jpg' : 'photo.jpg',
    'image/jpeg',
    123_456,
    null,
    null,
    null,
    null,
    createdAt,
  );
}

function seededRepository(): FakeMediaRepository {
  const repository = new FakeMediaRepository();
  const rows = [
    record(
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01',
      'garden_photo',
      new Date('2026-07-01T00:00:00Z'),
    ),
    record(
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
      'imported_plan',
      new Date('2026-07-02T00:00:00Z'),
    ),
    record(
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
      'imported_plan',
      new Date('2026-07-03T00:00:00Z'),
    ),
    record(
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a04',
      'imported_plan',
      new Date('2026-07-04T00:00:00Z'),
      OTHER_GARDEN_ID,
    ),
  ];
  for (const row of rows) {
    repository.records.set(row.id, row);
  }
  return repository;
}

describe('ListGardenMedia', () => {
  it('lists the garden`s originals, most recently created first, never another garden`s', async () => {
    const useCase = new ListGardenMedia(
      seededRepository(),
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: null,
      similarToMediaId: null,
      cursor: null,
      limit: 50,
    });

    expect(result.items.map((item) => item.id)).toEqual([
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01',
    ]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('excludes records once deletion has been scheduled or completed', async () => {
    const repository = seededRepository();
    const scheduledId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03';
    const deletedId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02';
    const scheduled = repository.records.get(scheduledId);
    const deleted = repository.records.get(deletedId);
    if (scheduled === undefined || deleted === undefined) {
      throw new Error('seed records missing');
    }
    repository.records.set(scheduledId, { ...scheduled, uploadState: 'deletion_scheduled' });
    repository.records.set(deletedId, { ...deleted, uploadState: 'deleted' });
    const useCase = new ListGardenMedia(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: null,
      similarToMediaId: null,
      cursor: null,
      limit: 50,
    });

    expect(result.items.map((item) => item.id)).toEqual(['019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01']);
  });

  it('filters to one media class and pages with a continuation cursor', async () => {
    const useCase = new ListGardenMedia(
      seededRepository(),
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const firstPage = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: 'imported_plan',
      checksumSha256: null,
      similarToMediaId: null,
      cursor: null,
      limit: 1,
    });
    expect(firstPage.items.map((item) => item.id)).toEqual([
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
    ]);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: 'imported_plan',
      checksumSha256: null,
      similarToMediaId: null,
      cursor: firstPage.nextCursor ?? null,
      limit: 1,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual([
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
    ]);
  });

  it('narrows to byte-identical originals when a checksum is given', async () => {
    const repository = seededRepository();
    const useCase = new ListGardenMedia(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const all = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: null,
      similarToMediaId: null,
      cursor: null,
      limit: 50,
    });
    const checksum = 'a'.repeat(64);

    // The exact-duplicate check a client runs against a photograph it just
    // hashed: identical bytes only. A re-encoded copy of the same scene has a
    // different checksum and is deliberately not found here.
    const matches = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: checksum,
      similarToMediaId: null,
      cursor: null,
      limit: 50,
    });

    expect(all.items.length).toBeGreaterThan(matches.items.length);
    expect(repository.lastListInput?.checksumSha256).toBe(checksum);
  });

  it('excludes derivative rows from the listing but resolves them onto their original', async () => {
    const repository = seededRepository();
    const original = repository.records.get('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03');
    if (original === undefined) {
      throw new Error('seed record missing');
    }
    const derivative: MediaRecord = {
      ...original,
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      mediaClass: 'derived_preview',
      uploadState: 'available',
      processingState: null,
      derivedFromMediaId: original.id,
      transformationVersion: 1,
      derivativeKind: 'screen_preview',
    };
    repository.records.set(derivative.id, derivative);

    const useCase = new ListGardenMedia(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: null,
      similarToMediaId: null,
      cursor: null,
      limit: 50,
    });
    expect(result.items.map((item) => item.id)).not.toContain(derivative.id);
    const listedOriginal = result.items.find((item) => item.id === original.id);
    expect(listedOriginal?.derivatives).toEqual([
      { derivativeKind: 'screen_preview', mediaId: derivative.id },
    ]);
  });

  it('conceals a garden the caller has no membership on as notFound', async () => {
    const useCase = new ListGardenMedia(seededRepository(), authorizationDenying());

    await expect(
      useCase.execute(GARDEN_ID, PROFILE_ID, {
        mediaClass: null,
        checksumSha256: null,
        similarToMediaId: null,
        cursor: null,
        limit: 50,
      }),
    ).rejects.toMatchObject({
      category: 'notFound',
    });
  });
  it('finds a re-encoded copy the checksum cannot see, and never the reference itself', () => {
    const repository = new FakeMediaRepository();
    const reference = {
      ...record('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11', 'garden_photo', new Date('2026-07-01Z')),
      perceptualHash: '0f1e2d3c4b5a6978',
    };
    const reEncoded = {
      ...record('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12', 'garden_photo', new Date('2026-07-02Z')),
      // Two bits apart: the same picture through a JPEG round trip.
      perceptualHash: '0f1e2d3c4b5a697b',
    };
    const different = {
      ...record('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13', 'garden_photo', new Date('2026-07-03Z')),
      perceptualHash: 'f0e1d2c3b4a59687',
    };
    for (const row of [reference, reEncoded, different]) {
      void repository.insert(row);
    }
    const useCase = new ListGardenMedia(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    return useCase
      .execute(GARDEN_ID, PROFILE_ID, {
        mediaClass: null,
        checksumSha256: null,
        similarToMediaId: reference.id,
        cursor: null,
        limit: 50,
      })
      .then((result) => {
        expect(result.items.map((item) => item.id)).toEqual([reEncoded.id]);
      });
  });

  it('answers an empty page when the reference has no hash rather than failing', async () => {
    // A media class that is not an image, or bytes the decoder refused. The
    // question is unanswerable, not malformed.
    const repository = new FakeMediaRepository();
    const reference = record(
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a21',
      'garden_photo',
      new Date('2026-07-01Z'),
    );
    void repository.insert(reference);
    const useCase = new ListGardenMedia(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: null,
      similarToMediaId: reference.id,
      cursor: null,
      limit: 50,
    });

    expect(result.items).toEqual([]);
  });

  it('treats a reference in another garden as absent, never as a denial', async () => {
    // Answering "that exists elsewhere" would leak the existence of media in
    // a garden the caller cannot see.
    const repository = new FakeMediaRepository();
    const foreign = {
      ...record(
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a31',
        'garden_photo',
        new Date('2026-07-01Z'),
        OTHER_GARDEN_ID,
      ),
      perceptualHash: '0f1e2d3c4b5a6978',
    };
    const mine = {
      ...record('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a32', 'garden_photo', new Date('2026-07-02Z')),
      perceptualHash: '0f1e2d3c4b5a6978',
    };
    for (const row of [foreign, mine]) {
      void repository.insert(row);
    }
    const useCase = new ListGardenMedia(
      repository,
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, {
      mediaClass: null,
      checksumSha256: null,
      similarToMediaId: foreign.id,
      cursor: null,
      limit: 50,
    });

    expect(result.items).toEqual([]);
  });
});
