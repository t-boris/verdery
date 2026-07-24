import type { MediaProcessingResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  authorizeMediaUpload,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
} from '../domain/media-lifecycle.js';
import { registerMediaRecord } from '../domain/media-record.js';
import { createProcessingJob, markProcessingJobQueued } from '../domain/processing-job.js';
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
});
