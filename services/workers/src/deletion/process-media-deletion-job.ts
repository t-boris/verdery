/**
 * Orchestrates one `media_deletion` job (P6-RET-01): deletes every object
 * under the manifest's `deletion.objectPrefixes`, verifies absence, and
 * records the outcome through the same authenticated callback both
 * processing kinds use — `services/api`'s `RecordMediaProcessingResult`
 * drives `deletion_scheduled -> deleted` from a `succeeded` outcome.
 *
 * Mirrors `ProcessMediaValidationJob`/`ProcessMediaDerivativeGenerationJob`'s
 * shape (`execute(manifest)`, records the result, returns it) so
 * `MediaProcessingJobRouter` treats all three interchangeably.
 *
 * Outcome mapping, honest to section 16 step 6:
 *
 * - Every prefix empty after deleting  -> `succeeded` (absence VERIFIED —
 *   the only outcome that lets the API mark the record `deleted`).
 * - Objects still present after deleting (a listing/consistency anomaly) ->
 *   the job THROWS, the HTTP target answers 5xx, and Cloud Tasks retries —
 *   "record provider retry state", not a false success.
 * - A manifest with no `deletion` block is terminally malformed
 *   (`failed_terminal`), never retried: retrying cannot grow it a block.
 *
 * A provider error mid-deletion also propagates as a retryable throw; the
 * work already done stays done (deletion is idempotent), and the retry
 * resumes against whatever objects remain.
 */

import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import type { MediaProcessingResultRecorder } from '../validation/media-processing-result-recorder.js';
import type { ObjectDeleter } from './object-deleter.js';

const PROCESSOR_VERSION = 'media-deletion-v1';

/** Thrown when a re-listed prefix still holds objects — retryable by contract (see this file's own header comment). */
export class DeletionVerificationFailedError extends Error {
  constructor(bucketName: string, remainingObjectCount: number) {
    super(
      `Deletion verification failed: ${String(remainingObjectCount)} object(s) still present in '${bucketName}' after deleting.`,
    );
    this.name = 'DeletionVerificationFailedError';
  }
}

export class ProcessMediaDeletionJob {
  constructor(
    private readonly deleter: ObjectDeleter,
    private readonly results: MediaProcessingResultRecorder,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult> {
    const startedAt = this.now();

    const prefixes = manifest.deletion?.objectPrefixes;
    if (prefixes === undefined || prefixes.length === 0) {
      const result: MediaProcessingResult = {
        jobId: manifest.jobId,
        processorVersion: PROCESSOR_VERSION,
        inputChecksums: [],
        outputObjects: [],
        resultSummary: { validationCode: 'deletion_manifest_missing', deletedObjectCount: 0 },
        qualityDiagnostics: null,
        resourceMetrics: { durationMs: Math.max(0, this.now() - startedAt) },
        outcome: 'failed_terminal',
      };
      await this.results.record(result);
      return result;
    }

    let deletedObjectCount = 0;
    for (const prefix of prefixes) {
      const outcome = await this.deleter.deletePrefix(prefix.bucketName, prefix.objectKeyPrefix);
      deletedObjectCount += outcome.deletedObjectCount;
      if (outcome.remainingObjectCount > 0) {
        throw new DeletionVerificationFailedError(prefix.bucketName, outcome.remainingObjectCount);
      }
    }

    const result: MediaProcessingResult = {
      jobId: manifest.jobId,
      processorVersion: PROCESSOR_VERSION,
      // A deletion job verifies absence, not content — created with no
      // expected checksums, so this stays empty by contract.
      inputChecksums: [],
      outputObjects: [],
      resultSummary: {
        deletedObjectCount,
        prefixCount: prefixes.length,
        absenceVerified: true,
      },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: Math.max(0, this.now() - startedAt) },
      outcome: 'succeeded',
    };
    await this.results.record(result);
    return result;
  }
}
