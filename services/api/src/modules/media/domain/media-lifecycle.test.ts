import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import {
  authorizeMediaUpload,
  beginMediaProcessing,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
  markMediaDeleted,
  markMediaProcessed,
  markMediaProcessingFailed,
  markMediaRejected,
  scheduleMediaDeletion,
} from './media-lifecycle.js';
import { registerMediaRecord } from './media-record.js';
import type { MediaRecord } from './media-record.js';

const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const T0 = new Date('2026-07-21T09:00:00Z');
const T1 = new Date('2026-07-21T09:05:00Z');
const CHECKSUM = 'a'.repeat(64);
const BUCKET = 'verdery-media-dev';
const OBJECT_KEY =
  'shard-01/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';

function registered(): MediaRecord {
  return registerMediaRecord(
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
    T0,
  );
}

function authorized(): MediaRecord {
  return authorizeMediaUpload(registered(), BUCKET, OBJECT_KEY, T0);
}

function uploading(): MediaRecord {
  return beginMediaUpload(authorized(), T0);
}

function verifying(): MediaRecord {
  return beginMediaVerification(uploading(), T0);
}

function available(): MediaRecord {
  return markMediaAvailable(verifying(), 'image/jpeg', 123_456, CHECKSUM, T0);
}

describe('authorizeMediaUpload', () => {
  it('moves registered to authorized, records the storage target, and bumps revision/updatedAt', () => {
    const result = authorizeMediaUpload(registered(), BUCKET, OBJECT_KEY, T1);

    expect(result.uploadState).toBe('authorized');
    expect(result.bucketName).toBe(BUCKET);
    expect(result.objectKey).toBe(OBJECT_KEY);
    expect(result.revision).toBe(2);
    expect(result.updatedAt).toEqual(T1);
  });

  it('rejects every source state other than registered', () => {
    expect(() => authorizeMediaUpload(authorized(), BUCKET, OBJECT_KEY, T1)).toThrow(
      DomainRuleViolatedError,
    );
    expect(() => authorizeMediaUpload(available(), BUCKET, OBJECT_KEY, T1)).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('beginMediaUpload', () => {
  it('moves authorized to uploading', () => {
    const result = beginMediaUpload(authorized(), T1);
    expect(result.uploadState).toBe('uploading');
    expect(result.revision).toBe(3);
  });

  it('rejects a registered (not yet authorized) source', () => {
    expect(() => beginMediaUpload(registered(), T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('beginMediaVerification', () => {
  it('moves uploading to verifying', () => {
    const result = beginMediaVerification(uploading(), T1);
    expect(result.uploadState).toBe('verifying');
  });

  it('rejects an authorized (not yet uploading) source', () => {
    expect(() => beginMediaVerification(authorized(), T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('markMediaAvailable', () => {
  it('moves verifying to available and records the verified values', () => {
    const result = markMediaAvailable(verifying(), 'image/jpeg', 123_456, CHECKSUM, T1);
    expect(result.uploadState).toBe('available');
    expect(result.verifiedContentType).toBe('image/jpeg');
    expect(result.verifiedByteSize).toBe(123_456);
    expect(result.checksumSha256).toBe(CHECKSUM);
  });

  it('rejects an uploading (not yet verifying) source', () => {
    expect(() => markMediaAvailable(uploading(), 'image/jpeg', 123_456, CHECKSUM, T1)).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('markMediaRejected', () => {
  it('moves verifying to rejected', () => {
    const result = markMediaRejected(verifying(), T1);
    expect(result.uploadState).toBe('rejected');
  });

  it('rejects an available (already accepted) source', () => {
    expect(() => markMediaRejected(available(), T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('beginMediaProcessing', () => {
  it('starts processing without changing uploadState away from available', () => {
    const result = beginMediaProcessing(available(), T1);
    expect(result.processingState).toBe('processing');
    expect(result.uploadState).toBe('available');
  });

  it('rejects a source not yet available', () => {
    expect(() => beginMediaProcessing(verifying(), T1)).toThrow(DomainRuleViolatedError);
  });

  it('rejects starting a second time while already processing', () => {
    const processing = beginMediaProcessing(available(), T1);
    expect(() => beginMediaProcessing(processing, T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('markMediaProcessed and markMediaProcessingFailed', () => {
  it('moves processing to processed without touching uploadState', () => {
    const processing = beginMediaProcessing(available(), T1);
    const processed = markMediaProcessed(processing, T1);
    expect(processed.processingState).toBe('processed');
    expect(processed.uploadState).toBe('available');
  });

  it('moves processing to processing_failed without touching uploadState', () => {
    const processing = beginMediaProcessing(available(), T1);
    const failed = markMediaProcessingFailed(processing, T1);
    expect(failed.processingState).toBe('processing_failed');
    expect(failed.uploadState).toBe('available');
  });

  it('rejects marking processed/processing_failed when processing never started', () => {
    expect(() => markMediaProcessed(available(), T1)).toThrow(DomainRuleViolatedError);
    expect(() => markMediaProcessingFailed(available(), T1)).toThrow(DomainRuleViolatedError);
  });

  it('rejects marking processed a second time (no back-edge from a terminal processing state)', () => {
    const processed = markMediaProcessed(beginMediaProcessing(available(), T1), T1);
    expect(() => markMediaProcessed(processed, T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('scheduleMediaDeletion', () => {
  it('moves available to deletion_scheduled regardless of processingState', () => {
    const stillUnprocessed = scheduleMediaDeletion(available(), T1);
    expect(stillUnprocessed.uploadState).toBe('deletion_scheduled');

    const midProcessing = beginMediaProcessing(available(), T1);
    const scheduledMidProcessing = scheduleMediaDeletion(midProcessing, T1);
    expect(scheduledMidProcessing.uploadState).toBe('deletion_scheduled');
    expect(scheduledMidProcessing.processingState).toBe('processing');
  });

  it('rejects a source not available (for example, still verifying, or already rejected)', () => {
    expect(() => scheduleMediaDeletion(verifying(), T1)).toThrow(DomainRuleViolatedError);
    expect(() => scheduleMediaDeletion(markMediaRejected(verifying(), T1), T1)).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('markMediaDeleted', () => {
  it('moves deletion_scheduled to deleted', () => {
    const scheduled = scheduleMediaDeletion(available(), T1);
    const deleted = markMediaDeleted(scheduled, T1);
    expect(deleted.uploadState).toBe('deleted');
  });

  it('rejects a source not yet deletion_scheduled', () => {
    expect(() => markMediaDeleted(available(), T1)).toThrow(DomainRuleViolatedError);
  });
});
