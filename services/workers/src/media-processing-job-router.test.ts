import type {
  ExportGenerationManifest,
  MediaProcessingManifest,
  MediaProcessingResult,
} from '@verdery/api-contracts';
import { EXPORT_GENERATION_JOB_KIND } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  MEDIA_VALIDATION_JOB_KIND,
} from './job-kind.js';
import { MediaProcessingJobRouter } from './media-processing-job-router.js';
import type {
  ExportGenerationJobExecutor,
  MediaProcessingJobExecutor,
} from './media-processing-job-router.js';

function manifestWithJobKind(jobKind?: string): MediaProcessingManifest {
  return {
    jobId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00',
    mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
    processorConfigVersion: 'v1',
    inputObjects: [{ bucketName: 'bucket', objectKey: 'object-key' }],
    expectedChecksums: [],
    validation: {
      mediaClass: 'garden_photo',
      displayFilename: 'photo.jpg',
      expectedContentType: 'image/jpeg',
      expectedByteSize: 123,
    },
    ...(jobKind === undefined ? {} : { jobKind }),
  };
}

function fakeExecutor(label: string): { executor: MediaProcessingJobExecutor; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    executor: {
      execute(manifest) {
        calls.push(manifest.jobId);
        const result: MediaProcessingResult = {
          jobId: manifest.jobId,
          processorVersion: label,
          inputChecksums: [],
          outputObjects: [],
          resultSummary: {},
          qualityDiagnostics: null,
          resourceMetrics: { durationMs: 1 },
          outcome: 'succeeded',
        };
        return Promise.resolve(result);
      },
    },
  };
}

function fakeExportExecutor(): { executor: ExportGenerationJobExecutor; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    executor: {
      execute(manifest) {
        calls.push(manifest.exportRequestId);
        return Promise.resolve();
      },
    },
  };
}

function buildRouter() {
  const validation = fakeExecutor('validator');
  const derivative = fakeExecutor('generator');
  const deletion = fakeExecutor('deleter');
  const exportGeneration = fakeExportExecutor();
  const router = new MediaProcessingJobRouter(
    validation.executor,
    derivative.executor,
    deletion.executor,
    exportGeneration.executor,
  );
  return { router, validation, derivative, deletion, exportGeneration };
}

describe('MediaProcessingJobRouter', () => {
  it('routes a media_validation manifest to the validation executor', async () => {
    const { router, validation, derivative } = buildRouter();

    const result = await router.execute(manifestWithJobKind(MEDIA_VALIDATION_JOB_KIND));

    expect((result as MediaProcessingResult).processorVersion).toBe('validator');
    expect(validation.calls).toHaveLength(1);
    expect(derivative.calls).toHaveLength(0);
  });

  it('routes a derivative_generation manifest to the derivative-generation executor', async () => {
    const { router, validation, derivative } = buildRouter();

    const result = await router.execute(manifestWithJobKind(MEDIA_DERIVATIVE_GENERATION_JOB_KIND));

    expect((result as MediaProcessingResult).processorVersion).toBe('generator');
    expect(derivative.calls).toHaveLength(1);
    expect(validation.calls).toHaveLength(0);
  });

  it('defaults an absent jobKind to validation — every P6-WORKER-01 manifest built before this field existed', async () => {
    const { router } = buildRouter();

    const result = await router.execute(manifestWithJobKind(undefined));

    expect((result as MediaProcessingResult).processorVersion).toBe('validator');
  });

  it('routes a media_deletion manifest to the deletion executor (P6-RET-01)', async () => {
    const { router, validation, derivative, deletion } = buildRouter();

    const result = await router.execute(manifestWithJobKind(MEDIA_DELETION_JOB_KIND));

    expect((result as MediaProcessingResult).processorVersion).toBe('deleter');
    expect(deletion.calls).toHaveLength(1);
    expect(validation.calls).toHaveLength(0);
    expect(derivative.calls).toHaveLength(0);
  });

  it('routes an export_generation manifest to the export executor and never a media one (P8-EXPORT-01)', async () => {
    const { router, validation, derivative, deletion, exportGeneration } = buildRouter();
    const manifest: ExportGenerationManifest = {
      jobId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c02',
      jobKind: EXPORT_GENERATION_JOB_KIND,
      exportRequestId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c03',
    };

    const result = await router.execute(manifest);

    expect(result).toBeUndefined();
    expect(exportGeneration.calls).toEqual(['019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c03']);
    expect(validation.calls).toHaveLength(0);
    expect(derivative.calls).toHaveLength(0);
    expect(deletion.calls).toHaveLength(0);
  });
});
