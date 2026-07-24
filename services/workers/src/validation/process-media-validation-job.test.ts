/**
 * Orchestration-layer tests for `ProcessMediaValidationJob` — the glue
 * between `MediaValidator`'s own deep-validation logic (already thoroughly
 * covered by `media-validator.test.ts`) and `MediaProcessingResultRecorder`
 * (the hop-2 caller into `services/api`). This suite proves three things
 * `media-validator.test.ts` cannot, because they live in this class, not in
 * `MediaValidator`:
 *
 * 1. A `raw_capture` (video) manifest is short-circuited BEFORE
 *    `MediaValidator`/`MediaObjectSource` is ever touched — the concrete
 *    proof that video handling stays out of scope for real, not just by
 *    convention (see `media-validator.ts`'s own header comment).
 * 2. `ObjectTooLargeError` (the byte-cap defense-in-depth signal) becomes a
 *    `failed_terminal` result, never an unhandled rejection.
 *   3. Any OTHER thrown error propagates uncaught, so the HTTP layer answers
 *    retryably (503) instead of recording a false terminal failure for a
 *    transient infrastructure problem.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import {
  ObjectTooLargeError,
  type MaterializedMediaObject,
  type MediaObjectSource,
} from './media-object-source.js';
import type { MediaProcessingResultRecorder } from './media-processing-result-recorder.js';
import { MediaValidator } from './media-validator.js';
import { ProcessMediaValidationJob } from './process-media-validation-job.js';
import { UnavailableMalwareScanner } from './validation-result.js';

class RecordingResultRecorder implements MediaProcessingResultRecorder {
  readonly recorded: MediaProcessingResult[] = [];

  record(result: MediaProcessingResult): Promise<void> {
    this.recorded.push(result);
    return Promise.resolve();
  }
}

/** A source that fails the test if it is ever called — proves a code path never downloads bytes. */
class NeverCalledObjectSource implements MediaObjectSource {
  materialize(): Promise<MaterializedMediaObject> {
    throw new Error('materialize() must not be called for this manifest.');
  }
}

class RejectingObjectSource implements MediaObjectSource {
  constructor(private readonly error: Error) {}

  materialize(): Promise<MaterializedMediaObject> {
    return Promise.reject(this.error);
  }
}

function rawCaptureManifest(): MediaProcessingManifest {
  return {
    jobId: randomUUID(),
    mediaId: randomUUID(),
    processorConfigVersion: 'v1',
    inputObjects: [{ bucketName: 'raw-capture-bucket', objectKey: 'opaque/object' }],
    expectedChecksums: ['a'.repeat(64)],
    validation: {
      mediaClass: 'raw_capture',
      displayFilename: 'scan.mp4',
      expectedContentType: 'video/mp4',
      expectedByteSize: 999_999_999,
    },
  };
}

function gardenPhotoManifest(): MediaProcessingManifest {
  return {
    jobId: randomUUID(),
    mediaId: randomUUID(),
    processorConfigVersion: 'v1',
    inputObjects: [{ bucketName: 'user-media-bucket', objectKey: 'opaque/object' }],
    expectedChecksums: [],
    validation: {
      mediaClass: 'garden_photo',
      displayFilename: 'photo.jpg',
      expectedContentType: 'image/jpeg',
      expectedByteSize: 1_000,
    },
  };
}

describe('ProcessMediaValidationJob', () => {
  it('short-circuits a raw_capture manifest as succeeded without ever downloading object bytes', async () => {
    const recorder = new RecordingResultRecorder();
    const processor = new ProcessMediaValidationJob(
      new MediaValidator(new NeverCalledObjectSource(), new UnavailableMalwareScanner()),
      recorder,
    );
    const manifest = rawCaptureManifest();

    const result = await processor.execute(manifest);

    expect(result.outcome).toBe('succeeded');
    expect(result.jobId).toBe(manifest.jobId);
    expect(result.resultSummary).toMatchObject({
      accepted: true,
      validationCode: 'video_validation_deferred',
    });
    // Carries the manifest's own declared checksums through unexamined —
    // nothing was independently confirmed against real bytes, matching this
    // stage's honest-placeholder discipline for a check it does not perform.
    expect(result.inputChecksums).toEqual(manifest.expectedChecksums);
    expect(recorder.recorded).toEqual([result]);
  });

  it('converts a real ObjectTooLargeError into a failed_terminal result instead of throwing', async () => {
    const recorder = new RecordingResultRecorder();
    const processor = new ProcessMediaValidationJob(
      new MediaValidator(
        new RejectingObjectSource(new ObjectTooLargeError(999_999, 1_000)),
        new UnavailableMalwareScanner(),
      ),
      recorder,
    );
    const manifest = gardenPhotoManifest();

    const result = await processor.execute(manifest);

    expect(result.outcome).toBe('failed_terminal');
    expect(result.resultSummary).toMatchObject({
      accepted: false,
      validationCode: 'byte_size_limit_exceeded',
    });
    expect(recorder.recorded).toEqual([result]);
  });

  it('propagates an unrelated (non-size) error uncaught, so the caller can answer retryably', async () => {
    const recorder = new RecordingResultRecorder();
    const processor = new ProcessMediaValidationJob(
      new MediaValidator(
        new RejectingObjectSource(new Error('object storage temporarily unavailable')),
        new UnavailableMalwareScanner(),
      ),
      recorder,
    );

    await expect(processor.execute(gardenPhotoManifest())).rejects.toThrow(
      'object storage temporarily unavailable',
    );
    expect(recorder.recorded).toHaveLength(0);
  });
});
