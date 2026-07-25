import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import { MEDIA_DELETION_JOB_KIND } from '../job-kind.js';
import type { ObjectDeleter, PrefixDeletionResult } from './object-deleter.js';
import {
  DeletionVerificationFailedError,
  ProcessMediaDeletionJob,
} from './process-media-deletion-job.js';

const JOB_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d00';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d01';

function manifest(overrides: Partial<MediaProcessingManifest> = {}): MediaProcessingManifest {
  return {
    jobId: JOB_ID,
    mediaId: MEDIA_ID,
    processorConfigVersion: 'v1',
    inputObjects: [{ bucketName: 'user-media', objectKey: 'ab/media/object' }],
    expectedChecksums: [],
    validation: {
      mediaClass: 'garden_photo',
      displayFilename: 'photo.jpg',
      expectedContentType: 'image/jpeg',
      expectedByteSize: 123,
    },
    jobKind: MEDIA_DELETION_JOB_KIND,
    deletion: {
      objectPrefixes: [
        { bucketName: 'user-media', objectKeyPrefix: 'ab/media/' },
        { bucketName: 'derived', objectKeyPrefix: 'ab/media/' },
      ],
    },
    ...overrides,
  };
}

class FakeObjectDeleter implements ObjectDeleter {
  readonly calls: { bucketName: string; objectKeyPrefix: string }[] = [];

  constructor(private readonly results: Record<string, PrefixDeletionResult> = {}) {}

  deletePrefix(bucketName: string, objectKeyPrefix: string): Promise<PrefixDeletionResult> {
    this.calls.push({ bucketName, objectKeyPrefix });
    return Promise.resolve(
      this.results[bucketName] ?? { deletedObjectCount: 0, remainingObjectCount: 0 },
    );
  }
}

class RecordingResultRecorder {
  readonly recorded: MediaProcessingResult[] = [];

  record(result: MediaProcessingResult): Promise<void> {
    this.recorded.push(result);
    return Promise.resolve();
  }
}

describe('ProcessMediaDeletionJob', () => {
  it('deletes every prefix, verifies absence, and records a succeeded result with the deleted count', async () => {
    const deleter = new FakeObjectDeleter({
      'user-media': { deletedObjectCount: 1, remainingObjectCount: 0 },
      derived: { deletedObjectCount: 12, remainingObjectCount: 0 },
    });
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDeletionJob(deleter, recorder, () => 1_000);

    const result = await job.execute(manifest());

    expect(result.outcome).toBe('succeeded');
    expect(result.resultSummary).toMatchObject({
      deletedObjectCount: 13,
      prefixCount: 2,
      absenceVerified: true,
    });
    expect(result.inputChecksums).toEqual([]);
    expect(deleter.calls).toEqual([
      { bucketName: 'user-media', objectKeyPrefix: 'ab/media/' },
      { bucketName: 'derived', objectKeyPrefix: 'ab/media/' },
    ]);
    expect(recorder.recorded).toHaveLength(1);
  });

  it('an already-empty prefix is success, not an error — deletion is idempotent under at-least-once delivery', async () => {
    const deleter = new FakeObjectDeleter();
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDeletionJob(deleter, recorder);

    const result = await job.execute(manifest());

    expect(result.outcome).toBe('succeeded');
    expect(result.resultSummary).toMatchObject({ deletedObjectCount: 0 });
  });

  it('throws (retryable) when a prefix still holds objects after deleting — absence was NOT verified, so no success may be reported', async () => {
    const deleter = new FakeObjectDeleter({
      'user-media': { deletedObjectCount: 1, remainingObjectCount: 2 },
    });
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDeletionJob(deleter, recorder);

    await expect(job.execute(manifest())).rejects.toBeInstanceOf(DeletionVerificationFailedError);
    expect(recorder.recorded).toHaveLength(0);
  });

  it('a deletion manifest without a deletion block is terminally malformed — retrying cannot grow it one', async () => {
    const deleter = new FakeObjectDeleter();
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDeletionJob(deleter, recorder);

    const { deletion: _omitted, ...withoutDeletion } = manifest();
    const result = await job.execute(withoutDeletion);

    expect(result.outcome).toBe('failed_terminal');
    expect(result.resultSummary).toMatchObject({ validationCode: 'deletion_manifest_missing' });
    expect(deleter.calls).toHaveLength(0);
    expect(recorder.recorded).toHaveLength(1);
  });

  it('a provider failure mid-deletion propagates as a retryable throw without recording a result', async () => {
    const deleter: ObjectDeleter = {
      deletePrefix: () => Promise.reject(new Error('storage unavailable')),
    };
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDeletionJob(deleter, recorder);

    await expect(job.execute(manifest())).rejects.toThrow('storage unavailable');
    expect(recorder.recorded).toHaveLength(0);
  });
});
