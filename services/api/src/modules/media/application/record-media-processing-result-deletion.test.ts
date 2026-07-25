/**
 * The P6-RET-01 half of `RecordMediaProcessingResult`'s unit coverage —
 * split out of `record-media-processing-result.test.ts` purely for the
 * repository's 600-line source-file rule: the deletion-versus-processing
 * race guards (a result landing against a source already in the deletion
 * pipeline) and the `media_deletion` result path itself. The shared
 * builders are duplicated narrowly rather than hoisted into
 * `media-test-doubles.ts`, which holds cross-command fakes, not
 * command-specific fixture builders.
 */

import type { MediaProcessingOutputObject, MediaProcessingResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  authorizeMediaUpload,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
} from '../domain/media-lifecycle.js';
import { registerMediaRecord } from '../domain/media-record.js';
import {
  createProcessingJob,
  markProcessingJobQueued,
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
} from '../domain/processing-job.js';
import type { ProcessingJob } from '../domain/processing-job.js';
import { commitQuotaReservation, reserveMediaQuota } from '../domain/quota-reservation.js';
import { RecordMediaProcessingResult } from './record-media-processing-result.js';
import { createMediaFakes, fixedClock, FakeMediaUnitOfWork } from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0c';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0b';
const JOB_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0a';
const NOW = new Date('2026-07-21T09:00:00Z');
const LATER = new Date('2026-07-21T09:05:00Z');
const SUCCESS_RESULT: MediaProcessingResult = {
  jobId: JOB_ID,
  processorVersion: 'media-validator-v1',
  inputChecksums: [],
  outputObjects: [],
  resultSummary: { accepted: true },
  qualityDiagnostics: null,
  resourceMetrics: { durationMs: 25 },
  outcome: 'succeeded',
};

const THUMBNAIL_OUTPUT: MediaProcessingOutputObject = {
  bucketName: 'derived-bucket',
  objectKey: 'ab/media/thumb-uuid',
  checksumSha256: 'a'.repeat(64),
  contentType: 'image/jpeg',
  byteSize: 8_000,
  derivativeKind: 'thumbnail',
  transformationVersion: 1,
};

function availableMedia() {
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
  const authorized = authorizeMediaUpload(registered, 'bucket', 'object-key', NOW);
  const uploading = beginMediaUpload(authorized, NOW);
  const verifying = beginMediaVerification(uploading, NOW);
  return markMediaAvailable(verifying, 'image/jpeg', 123_456, null, NOW);
}

function processedMedia() {
  return { ...availableMedia(), processingState: 'processed' as const };
}

function queuedJob(
  overrides: Partial<Parameters<typeof createProcessingJob>[0]> = {},
): ProcessingJob {
  const requested = createProcessingJob(
    {
      id: JOB_ID,
      mediaId: MEDIA_ID,
      processorConfigVersion: 'v1',
      inputChecksums: [],
      ...overrides,
    },
    NOW,
  );
  return markProcessingJobQueued(requested, NOW);
}

function queuedDerivativeJob(): ProcessingJob {
  return queuedJob({
    inputChecksums: ['b'.repeat(64)],
    jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  });
}

function buildUseCase() {
  const fakes = createMediaFakes();
  const useCase = new RecordMediaProcessingResult(
    new FakeMediaUnitOfWork(fakes),
    fixedClock(LATER),
    'test-derived',
  );
  return { useCase, fakes };
}

describe('RecordMediaProcessingResult under the deletion workflow (P6-RET-01)', () => {
  it('P6-RET-01 race guard: a derivative result against a deletion_scheduled source registers NOTHING, cancels the job, and re-emits a cleanup deletion event for the bytes it wrote', async () => {
    const { useCase, fakes } = buildUseCase();
    fakes.media.records.set(MEDIA_ID, {
      ...processedMedia(),
      uploadState: 'deletion_scheduled' as const,
    });
    await fakes.processingJobs.insert(queuedDerivativeJob());

    await useCase.execute(JOB_ID, {
      jobId: JOB_ID,
      processorVersion: 'media-derivative-generator-v1',
      inputChecksums: ['b'.repeat(64)],
      outputObjects: [THUMBNAIL_OUTPUT],
      resultSummary: { derivativeCount: 1 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 40 },
      outcome: 'succeeded',
    });

    // No derivative row registered under a dying source.
    expect(fakes.media.records.size).toBe(1);
    expect(fakes.processingJobs.jobs.get(JOB_ID)).toMatchObject({
      state: 'cancelled',
      outcomeCode: 'media_not_available',
    });
    // The standard deletion event was re-emitted so the written bytes die
    // under the same prefixes — idempotent with the main deletion.
    expect(fakes.outbox.events).toEqual([
      expect.objectContaining({ eventType: 'media.deletion_requested', aggregateId: MEDIA_ID }),
    ]);
  });

  it('P6-RET-01 race guard: a validation result against a deletion_scheduled source cancels the job without touching the media row', async () => {
    const { useCase, fakes } = buildUseCase();
    const scheduled = { ...availableMedia(), uploadState: 'deletion_scheduled' as const };
    fakes.media.records.set(MEDIA_ID, scheduled);
    await fakes.processingJobs.insert(queuedJob());

    const summary = await useCase.execute(JOB_ID, SUCCESS_RESULT);

    const media = await fakes.media.get(MEDIA_ID);
    expect(media?.uploadState).toBe('deletion_scheduled');
    expect(media?.processingState).toBeNull();
    expect(media?.revision).toBe(scheduled.revision);
    expect(fakes.processingJobs.jobs.get(JOB_ID)).toMatchObject({
      state: 'cancelled',
      outcomeCode: 'media_not_available',
    });
    // P6-OBS-01: the race guard names itself in the logged summary.
    expect(summary).toMatchObject({
      disposition: 'cancelled_source_unavailable',
      outcomeCode: 'media_not_available',
    });
  });

  it('P6-RET-01 race guard: a late delivery for an already-CANCELLED derivative job still re-covers its written bytes with a cleanup event', async () => {
    const { useCase, fakes } = buildUseCase();
    fakes.media.records.set(MEDIA_ID, {
      ...processedMedia(),
      uploadState: 'deletion_scheduled' as const,
    });
    const cancelled = {
      ...queuedDerivativeJob(),
      state: 'cancelled' as const,
      outcomeCode: 'media_deletion_scheduled',
    };
    await fakes.processingJobs.insert(cancelled);

    await useCase.execute(JOB_ID, {
      jobId: JOB_ID,
      processorVersion: 'media-derivative-generator-v1',
      inputChecksums: ['b'.repeat(64)],
      outputObjects: [THUMBNAIL_OUTPUT],
      resultSummary: { derivativeCount: 1 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 40 },
      outcome: 'succeeded',
    });

    // The duplicate-delivery no-op still emitted the byte cleanup.
    expect(fakes.processingJobs.jobs.get(JOB_ID)?.state).toBe('cancelled');
    expect(fakes.media.records.size).toBe(1);
    expect(fakes.outbox.events).toEqual([
      expect.objectContaining({ eventType: 'media.deletion_requested' }),
    ]);
  });

  describe('media_deletion results (P6-RET-01)', () => {
    function scheduledMedia() {
      return { ...availableMedia(), uploadState: 'deletion_scheduled' as const };
    }

    function queuedDeletionJob(): ProcessingJob {
      const requested = createProcessingJob(
        {
          id: JOB_ID,
          mediaId: MEDIA_ID,
          processorConfigVersion: 'v1',
          inputChecksums: [],
          jobKind: MEDIA_DELETION_JOB_KIND,
        },
        NOW,
      );
      return markProcessingJobQueued(requested, NOW);
    }

    const DELETION_SUCCESS: MediaProcessingResult = {
      jobId: JOB_ID,
      processorVersion: 'media-deletion-v1',
      inputChecksums: [],
      outputObjects: [],
      resultSummary: { deletedObjectCount: 3, prefixCount: 2, absenceVerified: true },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 60 },
      outcome: 'succeeded',
    };

    it('objects confirmed absent: marks the record deleted, releases the quota reservation, audits completion, completes the job', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, scheduledMedia());
      await fakes.quotaReservations.insert(
        commitQuotaReservation(
          reserveMediaQuota(
            '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b1a',
            'garden',
            GARDEN_ID,
            null,
            MEDIA_ID,
            123_456,
            NOW,
          ),
          NOW,
        ),
      );
      await fakes.processingJobs.insert(queuedDeletionJob());

      const summary = await useCase.execute(JOB_ID, DELETION_SUCCESS);

      expect((await fakes.media.get(MEDIA_ID))?.uploadState).toBe('deleted');
      expect(
        [...fakes.quotaReservations.reservations.values()].find((r) => r.mediaId === MEDIA_ID)
          ?.state,
      ).toBe('released');
      expect(fakes.audit.events).toEqual([
        expect.objectContaining({ eventType: 'media.deleted', actorType: 'system' }),
      ]);
      expect(fakes.processingJobs.jobs.get(JOB_ID)?.state).toBe('succeeded');
      // P6-OBS-01: section 19's "deletion lag" — the record was scheduled
      // at NOW (its `updatedAt`) and confirmed absent at LATER, 5 minutes
      // later; the summary carries exactly that difference for the
      // `media.processing.result_recorded` log line.
      expect(summary).toMatchObject({
        disposition: 'recorded',
        jobKind: MEDIA_DELETION_JOB_KIND,
        outcome: 'succeeded',
        deletionLagMs: 300_000,
        requestedToCompletedMs: 300_000,
      });
    });

    it('a non-success outcome records only the job — the record stays deletion_scheduled and user-visible deletion remains pending', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, scheduledMedia());
      await fakes.processingJobs.insert(queuedDeletionJob());

      await useCase.execute(JOB_ID, {
        ...DELETION_SUCCESS,
        resultSummary: { validationCode: 'deletion_manifest_missing', deletedObjectCount: 0 },
        outcome: 'failed_terminal',
      });

      expect((await fakes.media.get(MEDIA_ID))?.uploadState).toBe('deletion_scheduled');
      expect(fakes.processingJobs.jobs.get(JOB_ID)).toMatchObject({
        state: 'failed_terminal',
        outcomeCode: 'deletion_manifest_missing',
      });
      expect(fakes.audit.events).toHaveLength(0);
    });

    it('double completion is idempotent: a second deletion job for an already-deleted record converges without a second audit event', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, scheduledMedia());
      await fakes.processingJobs.insert(queuedDeletionJob());
      await useCase.execute(JOB_ID, DELETION_SUCCESS);
      expect((await fakes.media.get(MEDIA_ID))?.uploadState).toBe('deleted');

      const secondJobId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b1b';
      await fakes.processingJobs.insert(
        markProcessingJobQueued(
          createProcessingJob(
            {
              id: secondJobId,
              mediaId: MEDIA_ID,
              processorConfigVersion: 'v1',
              inputChecksums: [],
              jobKind: MEDIA_DELETION_JOB_KIND,
            },
            NOW,
          ),
          NOW,
        ),
      );
      await useCase.execute(secondJobId, { ...DELETION_SUCCESS, jobId: secondJobId });

      expect((await fakes.media.get(MEDIA_ID))?.uploadState).toBe('deleted');
      expect(fakes.audit.events.filter((e) => e.eventType === 'media.deleted')).toHaveLength(1);
      expect(fakes.processingJobs.jobs.get(secondJobId)?.state).toBe('succeeded');
    });
  });
});
