import type { MediaDerivativeKind, MediaProcessingOutputObject } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import { registerMediaRecord } from '../domain/media-record.js';
import { parseDerivativeOutput, registerDerivativeIfAbsent } from './derivative-registration.js';
import { createMediaFakes, FakeMediaUnitOfWork, fixedClock } from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b20';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b21';
const SOURCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b22';
const NOW = new Date('2026-07-21T09:00:00Z');
const CHECKSUM = 'c'.repeat(64);

function sourceMedia() {
  return registerMediaRecord(
    SOURCE_ID,
    GARDEN_ID,
    PROFILE_ID,
    'imported_plan',
    'plan.jpg',
    'image/jpeg',
    5_000_000,
    null,
    null,
    null,
    null,
    NOW,
  );
}

const THUMBNAIL_OUTPUT: MediaProcessingOutputObject = {
  bucketName: 'derived-bucket',
  objectKey: 'ab/source/thumb-uuid',
  checksumSha256: CHECKSUM,
  contentType: 'image/jpeg',
  byteSize: 8_000,
  derivativeKind: 'thumbnail',
  transformationVersion: 1,
};

const TILE_OUTPUT: MediaProcessingOutputObject = {
  bucketName: 'derived-bucket',
  objectKey: 'ab/source/tile-uuid',
  checksumSha256: 'd'.repeat(64),
  contentType: 'image/png',
  byteSize: 20_000,
  derivativeKind: 'tile',
  transformationVersion: 1,
  tile: { zoomLevel: 2, x: 1, y: 3 },
};

describe('parseDerivativeOutput', () => {
  it('parses a well-formed non-tile output object', () => {
    expect(parseDerivativeOutput(THUMBNAIL_OUTPUT)).toEqual({
      bucketName: 'derived-bucket',
      objectKey: 'ab/source/thumb-uuid',
      checksumSha256: CHECKSUM,
      contentType: 'image/jpeg',
      byteSize: 8_000,
      derivativeKind: 'thumbnail',
      transformationVersion: 1,
      tile: null,
    });
  });

  it('parses a well-formed tile output object', () => {
    expect(parseDerivativeOutput(TILE_OUTPUT)).toMatchObject({
      derivativeKind: 'tile',
      tile: { zoomLevel: 2, x: 1, y: 3 },
    });
  });

  it('returns null for a media_validation job output object (no derivative fields at all)', () => {
    expect(
      parseDerivativeOutput({ bucketName: 'b', objectKey: 'k', checksumSha256: CHECKSUM }),
    ).toBeNull();
  });

  it('returns null for a non-tile kind that carries tile coordinates anyway', () => {
    expect(
      parseDerivativeOutput({ ...THUMBNAIL_OUTPUT, tile: { zoomLevel: 0, x: 0, y: 0 } }),
    ).toBeNull();
  });

  it('returns null for derivativeKind tile with no tile coordinates', () => {
    const { tile: _tile, ...tileOutputWithoutCoordinates } = TILE_OUTPUT;
    expect(parseDerivativeOutput(tileOutputWithoutCoordinates)).toBeNull();
  });

  it('returns null for an unrecognized derivativeKind', () => {
    expect(
      parseDerivativeOutput({
        ...THUMBNAIL_OUTPUT,
        derivativeKind: 'bogus' as unknown as MediaDerivativeKind,
      }),
    ).toBeNull();
  });
});

describe('registerDerivativeIfAbsent', () => {
  function buildContext() {
    const fakes = createMediaFakes();
    const unitOfWork = new FakeMediaUnitOfWork(fakes);
    return { fakes, unitOfWork };
  }

  it('registers a new derivative row derived from the source, propagating gardenId/uploadedByProfileId', async () => {
    const { fakes, unitOfWork } = buildContext();
    const source = sourceMedia();
    const parsed = parseDerivativeOutput(THUMBNAIL_OUTPUT);
    if (parsed === null) throw new Error('fixture must parse');

    const record = await unitOfWork.run((context) =>
      registerDerivativeIfAbsent(context, source, parsed, fixedClock(NOW).now()),
    );

    expect(record.mediaClass).toBe('derived_preview');
    expect(record.gardenId).toBe(GARDEN_ID);
    expect(record.uploadedByProfileId).toBe(PROFILE_ID);
    expect(record.uploadState).toBe('available');
    expect(record.processingState).toBeNull();
    expect(record.derivedFromMediaId).toBe(SOURCE_ID);
    expect(record.transformationVersion).toBe(1);
    expect(record.derivativeKind).toBe('thumbnail');
    // The source fixture is an imported_plan, whose class default is
    // 'sensitive' — the derivative must inherit it, never reset to
    // derived_preview's own 'standard' default (a real, latent
    // authorization bug fixed after this stage's first review; see
    // RegisterDerivativeMediaRecordInput's own field comment).
    expect(record.sensitivityClassification).toBe('sensitive');
    expect(fakes.media.records.size).toBe(1);
  });

  it('is idempotent: the exact same source/version/kind identity is a no-op, not a duplicate row', async () => {
    const { fakes, unitOfWork } = buildContext();
    const source = sourceMedia();
    const parsed = parseDerivativeOutput(THUMBNAIL_OUTPUT);
    if (parsed === null) throw new Error('fixture must parse');

    const first = await unitOfWork.run((context) =>
      registerDerivativeIfAbsent(context, source, parsed, NOW),
    );
    const second = await unitOfWork.run((context) =>
      registerDerivativeIfAbsent(context, source, parsed, NOW),
    );

    expect(second.id).toBe(first.id);
    expect(fakes.media.records.size).toBe(1);
  });

  it('a genuinely new transformationVersion produces a new, distinct derivative row', async () => {
    const { fakes, unitOfWork } = buildContext();
    const source = sourceMedia();
    const parsed = parseDerivativeOutput(THUMBNAIL_OUTPUT);
    if (parsed === null) throw new Error('fixture must parse');
    const parsedV2 = { ...parsed, transformationVersion: 2 };

    const first = await unitOfWork.run((context) =>
      registerDerivativeIfAbsent(context, source, parsed, NOW),
    );
    const second = await unitOfWork.run((context) =>
      registerDerivativeIfAbsent(context, source, parsedV2, NOW),
    );

    expect(second.id).not.toBe(first.id);
    expect(second.transformationVersion).toBe(2);
    expect(fakes.media.records.size).toBe(2);
  });

  it('two different derivative kinds from the same source/version are two distinct rows', async () => {
    const { fakes, unitOfWork } = buildContext();
    const source = sourceMedia();
    const thumbnail = parseDerivativeOutput(THUMBNAIL_OUTPUT);
    const tile = parseDerivativeOutput(TILE_OUTPUT);
    if (thumbnail === null || tile === null) throw new Error('fixtures must parse');

    await unitOfWork.run((context) => registerDerivativeIfAbsent(context, source, thumbnail, NOW));
    await unitOfWork.run((context) => registerDerivativeIfAbsent(context, source, tile, NOW));

    expect(fakes.media.records.size).toBe(2);
  });

  it('a duplicate insert that races the application-level check is resolved to the row the database actually accepted, not surfaced as an error', async () => {
    const source = sourceMedia();
    const parsed = parseDerivativeOutput(THUMBNAIL_OUTPUT);
    if (parsed === null) throw new Error('fixture must parse');

    // A minimal, purpose-built fake proving the CATCH branch specifically:
    // `findDerivative` reports "absent" on its first call (the race window
    // — a concurrent writer has not committed yet), `insert` then fails the
    // way a real unique-index violation does (the concurrent writer won),
    // and the SECOND `findDerivative` call inside the catch is what
    // resolves the already-registered row — exactly what
    // `services/api/src/platform/database/postgres-errors.ts`'s
    // `isUniqueViolation` exists to translate, mirroring
    // `run-idempotent-command.ts`'s own precedent.
    const winnerRow = {
      ...source,
      id: 'winner-id',
      mediaClass: 'derived_preview' as const,
      derivedFromMediaId: source.id,
      transformationVersion: 1,
      derivativeKind: 'thumbnail' as const,
    };
    let findDerivativeCalls = 0;
    const context = {
      media: {
        insert: () => {
          const error = Object.assign(new Error('duplicate key value'), { code: '23505' });
          return Promise.reject(error);
        },
        findDerivative: () => {
          findDerivativeCalls += 1;
          return Promise.resolve(findDerivativeCalls === 1 ? null : winnerRow);
        },
        get: () => Promise.resolve(null),
        update: () => Promise.resolve(false),
      },
    } as unknown as Parameters<typeof registerDerivativeIfAbsent>[0];

    const raced = await registerDerivativeIfAbsent(context, source, parsed, NOW);

    expect(raced).toEqual(winnerRow);
    expect(findDerivativeCalls).toBe(2);
  });

  it('re-throws a genuinely unexpected insert failure rather than masking it as a race', async () => {
    const source = sourceMedia();
    const parsed = parseDerivativeOutput(THUMBNAIL_OUTPUT);
    if (parsed === null) throw new Error('fixture must parse');
    const unexpected = new Error('connection reset');
    const context = {
      media: {
        insert: () => Promise.reject(unexpected),
        findDerivative: () => Promise.resolve(null),
        get: () => Promise.resolve(null),
        update: () => Promise.resolve(false),
      },
    } as unknown as Parameters<typeof registerDerivativeIfAbsent>[0];

    await expect(registerDerivativeIfAbsent(context, source, parsed, NOW)).rejects.toBe(unexpected);
  });
});
