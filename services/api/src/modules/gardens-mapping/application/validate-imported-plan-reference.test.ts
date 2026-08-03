import { describe, expect, it } from 'vitest';
import type { GardenObjectDetails } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import { requireImportedBackgroundPlanMedia } from './validate-imported-plan-reference.js';

const GARDEN_ID = '018f0000-0000-7000-8000-00000000aaaa';
const OTHER_GARDEN_ID = '018f0000-0000-7000-8000-00000000bbbb';
const PLAN_MEDIA_ID = '018f0000-0000-7000-8000-00000000cccc';

function planMediaRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: PLAN_MEDIA_ID,
    gardenId: GARDEN_ID,
    uploadedByProfileId: '018f0000-0000-7000-8000-00000000dddd',
    mediaClass: 'imported_plan',
    displayFilename: 'plan.jpg',
    declaredContentType: 'image/jpeg',
    verifiedContentType: 'image/jpeg',
    declaredByteSize: 5_000_000,
    verifiedByteSize: 5_000_000,
    checksumSha256: null,
    perceptualHash: null,
    bucketName: 'test-user-media',
    objectKey: 'shard/media/object',
    uploadState: 'available',
    processingState: 'processed',
    captureSessionId: null,
    sensitivityClassification: 'sensitive',
    retentionDeadlineAt: null,
    derivedFromMediaId: null,
    transformationVersion: null,
    derivativeKind: null,
    tileZoomLevel: null,
    tileX: null,
    tileY: null,
    revision: 4,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

/** Only `getForShare` is exercised — the validator never writes or lists. */
class FakeMediaRepository implements MediaRepository {
  constructor(private readonly record: MediaRecord | null) {}

  get(id: string): Promise<MediaRecord | null> {
    return Promise.resolve(this.record !== null && this.record.id === id ? this.record : null);
  }

  getForShare(id: string): Promise<MediaRecord | null> {
    return this.get(id);
  }

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  update(): Promise<boolean> {
    throw new Error('not used by this test');
  }

  findDerivative(): Promise<MediaRecord | null> {
    throw new Error('not used by this test');
  }

  listForGarden(): ReturnType<MediaRepository['listForGarden']> {
    throw new Error('not used by this test');
  }

  listDisplayDerivatives(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  listPurgeCandidates(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  countUndeletedForPurge(): Promise<number> {
    throw new Error('not used by this test');
  }

  scheduleDerivativesForDeletion(): Promise<number> {
    throw new Error('not used by this test');
  }

  markScheduledDerivativesDeleted(): Promise<number> {
    throw new Error('not used by this test');
  }

  listRetentionExpired(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  listStaleUploads(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }
}

function backgroundDetails(
  overrides: Partial<{ planMediaId: string; sourcePageNumber: number }> = {},
): GardenObjectDetails {
  return {
    category: 'importedBackground',
    details: {
      planMediaId: PLAN_MEDIA_ID,
      isBackgroundVisible: true,
      calibrationState: 'uncalibrated',
      ...overrides,
    },
  };
}

describe('requireImportedBackgroundPlanMedia', () => {
  it('accepts an available, processed imported_plan in the same garden', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord()),
        GARDEN_ID,
        backgroundDetails(),
      ),
    ).resolves.toBeUndefined();
  });

  it('ignores absent details and every other category', async () => {
    const media = new FakeMediaRepository(null);
    await expect(
      requireImportedBackgroundPlanMedia(media, GARDEN_ID, undefined),
    ).resolves.toBeUndefined();
    await expect(
      requireImportedBackgroundPlanMedia(media, GARDEN_ID, {
        category: 'zone',
        details: { zoneKind: 'lawn' },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a nonexistent media id', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(null),
        GARDEN_ID,
        backgroundDetails(),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a media record in a different garden, identically to a nonexistent one', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord({ gardenId: OTHER_GARDEN_ID })),
        GARDEN_ID,
        backgroundDetails(),
      ),
    ).rejects.toMatchObject({
      details: [{ code: 'map.imported_background.plan_media_not_found' }],
    });
  });

  it('rejects a media record that is not an imported plan', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord({ mediaClass: 'garden_photo' })),
        GARDEN_ID,
        backgroundDetails(),
      ),
    ).rejects.toMatchObject({
      details: [{ code: 'map.imported_background.plan_media_not_found' }],
    });
  });

  it('rejects a plan that has not reached available + processed', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord({ uploadState: 'verifying' })),
        GARDEN_ID,
        backgroundDetails(),
      ),
    ).rejects.toMatchObject({
      details: [{ code: 'map.imported_background.plan_media_not_ready' }],
    });
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord({ processingState: 'processing' })),
        GARDEN_ID,
        backgroundDetails(),
      ),
    ).rejects.toMatchObject({
      details: [{ code: 'map.imported_background.plan_media_not_ready' }],
    });
  });

  it('rejects a page above 1 for a raster plan', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord()),
        GARDEN_ID,
        backgroundDetails({ sourcePageNumber: 2 }),
      ),
    ).rejects.toMatchObject({
      details: [{ code: 'map.imported_background.page_number_not_applicable' }],
    });
  });

  it('accepts page 1 for a raster plan, and any positive page for a PDF plan', async () => {
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(planMediaRecord()),
        GARDEN_ID,
        backgroundDetails({ sourcePageNumber: 1 }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireImportedBackgroundPlanMedia(
        new FakeMediaRepository(
          planMediaRecord({
            displayFilename: 'plan.pdf',
            declaredContentType: 'application/pdf',
            verifiedContentType: 'application/pdf',
          }),
        ),
        GARDEN_ID,
        backgroundDetails({ sourcePageNumber: 7 }),
      ),
    ).resolves.toBeUndefined();
  });
});
