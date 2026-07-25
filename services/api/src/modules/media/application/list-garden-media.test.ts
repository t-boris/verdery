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

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, null, null, 50);

    expect(result.items.map((item) => item.id)).toEqual([
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01',
    ]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('filters to one media class and pages with a continuation cursor', async () => {
    const useCase = new ListGardenMedia(
      seededRepository(),
      authorizationGranting(buildMembership({ gardenId: GARDEN_ID, role: 'viewer' })),
    );

    const firstPage = await useCase.execute(GARDEN_ID, PROFILE_ID, 'imported_plan', null, 1);
    expect(firstPage.items.map((item) => item.id)).toEqual([
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
    ]);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await useCase.execute(
      GARDEN_ID,
      PROFILE_ID,
      'imported_plan',
      firstPage.nextCursor ?? null,
      1,
    );
    expect(secondPage.items.map((item) => item.id)).toEqual([
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
    ]);
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

    const result = await useCase.execute(GARDEN_ID, PROFILE_ID, null, null, 50);
    expect(result.items.map((item) => item.id)).not.toContain(derivative.id);
    const listedOriginal = result.items.find((item) => item.id === original.id);
    expect(listedOriginal?.derivatives).toEqual([
      { derivativeKind: 'screen_preview', mediaId: derivative.id },
    ]);
  });

  it('conceals a garden the caller has no membership on as notFound', async () => {
    const useCase = new ListGardenMedia(seededRepository(), authorizationDenying());

    await expect(useCase.execute(GARDEN_ID, PROFILE_ID, null, null, 50)).rejects.toMatchObject({
      category: 'notFound',
    });
  });
});
