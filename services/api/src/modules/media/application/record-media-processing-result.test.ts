import { MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
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
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
} from '../domain/processing-job.js';
import type { ProcessingJob } from '../domain/processing-job.js';
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

function buildUseCase() {
  const fakes = createMediaFakes();
  const useCase = new RecordMediaProcessingResult(
    new FakeMediaUnitOfWork(fakes),
    fixedClock(LATER),
  );
  return { useCase, fakes };
}

describe('RecordMediaProcessingResult', () => {
  it('records a successful validator result and drives media.processingState to processed', async () => {
    const { useCase, fakes } = buildUseCase();
    fakes.media.records.set(MEDIA_ID, availableMedia());
    await fakes.processingJobs.insert(queuedJob());

    await useCase.execute(JOB_ID, SUCCESS_RESULT);

    const media = await fakes.media.get(MEDIA_ID);
    expect(media?.processingState).toBe('processed');
    // registered(1) -> authorized(2) -> uploading(3) -> verifying(4) ->
    // available(5) -> processing(6) -> processed(7)
    expect(media?.revision).toBe(7);

    const job = await fakes.processingJobs.get(JOB_ID);
    expect(job?.state).toBe('succeeded');
    expect(job?.outcomeCode).toBe('succeeded');
    expect(job?.resultSummary).toMatchObject({ accepted: true });
    expect(job?.completedAt).toEqual(LATER);
  });

  it('throws when no job exists at the given id', async () => {
    const { useCase } = buildUseCase();

    await expect(useCase.execute(JOB_ID, SUCCESS_RESULT)).rejects.toMatchObject({
      category: 'notFound',
    });
  });

  it('records a terminal validation rejection and marks media processing failed', async () => {
    const { useCase, fakes } = buildUseCase();
    fakes.media.records.set(MEDIA_ID, availableMedia());
    await fakes.processingJobs.insert(queuedJob());

    await useCase.execute(JOB_ID, {
      ...SUCCESS_RESULT,
      resultSummary: { accepted: false, validationCode: 'malformed_file' },
      qualityDiagnostics: { validationCode: 'malformed_file' },
      outcome: 'failed_terminal',
    });

    expect((await fakes.media.get(MEDIA_ID))?.processingState).toBe('processing_failed');
    const job = await fakes.processingJobs.get(JOB_ID);
    expect(job).toMatchObject({
      state: 'failed_terminal',
      outcomeCode: 'malformed_file',
      qualityDiagnostics: { validationCode: 'malformed_file' },
    });
  });

  it('rejects a successful result that does not confirm the expected checksum', async () => {
    const { useCase, fakes } = buildUseCase();
    fakes.media.records.set(MEDIA_ID, availableMedia());
    await fakes.processingJobs.insert(queuedJob({ inputChecksums: ['a'.repeat(64)] }));

    await expect(useCase.execute(JOB_ID, SUCCESS_RESULT)).rejects.toMatchObject({
      category: 'domainRuleViolated',
      code: 'media.processing_result.input_checksum_mismatch',
    });
    expect((await fakes.media.get(MEDIA_ID))?.processingState).toBeNull();
  });

  it('is idempotent: a duplicate delivery against an already-succeeded job is a silent no-op', async () => {
    const { useCase, fakes } = buildUseCase();
    fakes.media.records.set(MEDIA_ID, availableMedia());
    await fakes.processingJobs.insert(queuedJob());

    await useCase.execute(JOB_ID, SUCCESS_RESULT);
    const jobAfterFirst = await fakes.processingJobs.get(JOB_ID);

    await useCase.execute(JOB_ID, SUCCESS_RESULT);
    const jobAfterSecond = await fakes.processingJobs.get(JOB_ID);

    expect(jobAfterSecond).toEqual(jobAfterFirst);
  });

  // A genuine "two concurrent deliveries race for the same job" scenario
  // needs real overlapping database transactions to reproduce honestly — an
  // in-memory fake's synchronous get-then-update has no way to interleave a
  // second writer between them. See
  // tests/integration/media-processing.test.ts's own concurrent-delivery
  // case for that proof against real PostgreSQL.

  describe('derivative-generation chaining (P6-WORKER-02)', () => {
    it('a successful validation result for a raster-eligible media class appends media.derivative_generation_requested', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, availableMedia());
      await fakes.processingJobs.insert(queuedJob());

      await useCase.execute(JOB_ID, {
        ...SUCCESS_RESULT,
        inputChecksums: ['e'.repeat(64)],
        resultSummary: { accepted: true, detectedContentType: 'image/jpeg', byteSize: 123_456 },
      });

      expect(fakes.outbox.events).toHaveLength(1);
      expect(fakes.outbox.events[0]).toMatchObject({
        eventType: MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
        aggregateType: 'media_record',
        aggregateId: MEDIA_ID,
        payload: {
          mediaId: MEDIA_ID,
          gardenId: GARDEN_ID,
          mediaClass: 'garden_photo',
          bucketName: 'bucket',
          objectKey: 'object-key',
          contentType: 'image/jpeg',
          byteSize: 123_456,
          checksumSha256: 'e'.repeat(64),
        },
      });
    });

    it('a successful validation result for a PDF-classed imported_plan does NOT append the derivative event (out of scope this stage)', async () => {
      const { useCase, fakes } = buildUseCase();
      const plan = registerMediaRecord(
        MEDIA_ID,
        GARDEN_ID,
        PROFILE_ID,
        'imported_plan',
        'plan.pdf',
        'application/pdf',
        200_000,
        null,
        null,
        null,
        null,
        NOW,
      );
      const authorized = authorizeMediaUpload(plan, 'bucket', 'object-key', NOW);
      const uploading = beginMediaUpload(authorized, NOW);
      const verifying = beginMediaVerification(uploading, NOW);
      fakes.media.records.set(
        MEDIA_ID,
        markMediaAvailable(verifying, 'application/pdf', 200_000, null, NOW),
      );
      await fakes.processingJobs.insert(queuedJob());

      await useCase.execute(JOB_ID, {
        ...SUCCESS_RESULT,
        inputChecksums: ['f'.repeat(64)],
        resultSummary: {
          accepted: true,
          detectedContentType: 'application/pdf',
          byteSize: 200_000,
        },
      });

      expect(fakes.outbox.events).toHaveLength(0);
    });

    it('a validation FAILURE does not append the derivative event either', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, availableMedia());
      await fakes.processingJobs.insert(queuedJob());

      await useCase.execute(JOB_ID, {
        ...SUCCESS_RESULT,
        resultSummary: { accepted: false, validationCode: 'malformed_file' },
        outcome: 'failed_terminal',
      });

      expect(fakes.outbox.events).toHaveLength(0);
    });

    const THUMBNAIL_OUTPUT: MediaProcessingOutputObject = {
      bucketName: 'derived-bucket',
      objectKey: 'ab/media/thumb-uuid',
      checksumSha256: 'a'.repeat(64),
      contentType: 'image/jpeg',
      byteSize: 8_000,
      derivativeKind: 'thumbnail',
      transformationVersion: 1,
    };

    function queuedDerivativeJob(): ProcessingJob {
      const requested = createProcessingJob(
        {
          id: JOB_ID,
          mediaId: MEDIA_ID,
          processorConfigVersion: 'v1',
          inputChecksums: ['b'.repeat(64)],
          jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
        },
        NOW,
      );
      return markProcessingJobQueued(requested, NOW);
    }

    function processedMedia() {
      const available = availableMedia();
      // A derivative-generation job only ever targets a media row whose OWN
      // validation already succeeded — `processingState` is already
      // `processed`, never `null`, by the time this job's result arrives.
      return { ...available, processingState: 'processed' as const };
    }

    it('registers each produced output object as its own new media_record row, without re-touching the source processingState', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, processedMedia());
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

      const source = await fakes.media.get(MEDIA_ID);
      // Source media untouched beyond what it already was — the source's
      // OWN processingState/revision never move a second time for this job
      // kind (see this module's own header comment on why).
      expect(source?.processingState).toBe('processed');
      expect(source?.revision).toBe(processedMedia().revision);

      const derivative = await fakes.media.findDerivative({
        derivedFromMediaId: MEDIA_ID,
        transformationVersion: 1,
        derivativeKind: 'thumbnail',
        tile: null,
      });
      expect(derivative).not.toBeNull();
      expect(derivative?.mediaClass).toBe('derived_preview');
      expect(derivative?.uploadState).toBe('available');
      expect(derivative?.bucketName).toBe('derived-bucket');

      const job = await fakes.processingJobs.get(JOB_ID);
      expect(job?.state).toBe('succeeded');
    });

    it('regenerating the exact same derivative for the exact same source+version+kind is a safe no-op: no duplicate media_record row', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, processedMedia());
      await fakes.processingJobs.insert(queuedDerivativeJob());

      const result: MediaProcessingResult = {
        jobId: JOB_ID,
        processorVersion: 'media-derivative-generator-v1',
        inputChecksums: ['b'.repeat(64)],
        outputObjects: [THUMBNAIL_OUTPUT],
        resultSummary: { derivativeCount: 1 },
        qualityDiagnostics: null,
        resourceMetrics: { durationMs: 40 },
        outcome: 'succeeded',
      };
      await useCase.execute(JOB_ID, result);
      const countAfterFirst = fakes.media.records.size;

      // A second, independent derivative-generation job for the SAME media,
      // reporting the identical output object (a real operator re-run, or a
      // fresh outbox delivery reaching a second job) — not the SAME job id
      // (that case is already covered by the generic "duplicate delivery"
      // no-op above, at the job-state level).
      const secondJobId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0e';
      await fakes.processingJobs.insert(
        markProcessingJobQueued(
          createProcessingJob(
            {
              id: secondJobId,
              mediaId: MEDIA_ID,
              processorConfigVersion: 'v1',
              inputChecksums: ['b'.repeat(64)],
              jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
            },
            NOW,
          ),
          NOW,
        ),
      );
      await useCase.execute(secondJobId, { ...result, jobId: secondJobId });

      expect(fakes.media.records.size).toBe(countAfterFirst);
    });

    it('a genuinely new transformationVersion produces a new derivative row alongside the old one', async () => {
      const { useCase, fakes } = buildUseCase();
      fakes.media.records.set(MEDIA_ID, processedMedia());
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
      const countAfterFirst = fakes.media.records.size;

      const secondJobId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b0f';
      await fakes.processingJobs.insert(
        markProcessingJobQueued(
          createProcessingJob(
            {
              id: secondJobId,
              mediaId: MEDIA_ID,
              processorConfigVersion: 'v1',
              inputChecksums: ['b'.repeat(64)],
              jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
            },
            NOW,
          ),
          NOW,
        ),
      );
      await useCase.execute(secondJobId, {
        jobId: secondJobId,
        processorVersion: 'media-derivative-generator-v1',
        inputChecksums: ['b'.repeat(64)],
        outputObjects: [{ ...THUMBNAIL_OUTPUT, transformationVersion: 2 }],
        resultSummary: { derivativeCount: 1 },
        qualityDiagnostics: null,
        resourceMetrics: { durationMs: 40 },
        outcome: 'succeeded',
      });

      expect(fakes.media.records.size).toBe(countAfterFirst + 1);
    });
  });
});
