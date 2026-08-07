/**
 * Orchestration-layer tests for `ProcessMediaDerivativeGenerationJob` —
 * proves the FULL real pipeline end to end against real `sharp` decode/
 * resize/tile logic (fake `MediaObjectSource`/`DerivativeObjectSink` supply
 * and capture bytes; nothing about the image processing itself is mocked),
 * mirroring `../validation/process-media-validation-job.test.ts`'s own
 * orchestration-layer coverage shape on the validation side.
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ObjectTooLargeError,
  type MaterializedMediaObject,
  type MediaObjectSource,
} from '../validation/media-object-source.js';
import type { MediaProcessingResultRecorder } from '../validation/media-processing-result-recorder.js';
import type { DerivativeObjectSink, StoredDerivativeObject } from './derivative-object-sink.js';
import { PopplerPdfPageRasterizer } from './poppler-pdf-page-rasterizer.js';
import { ProcessMediaDerivativeGenerationJob } from './process-media-derivative-generation-job.js';

class RecordingResultRecorder implements MediaProcessingResultRecorder {
  readonly recorded: MediaProcessingResult[] = [];

  record(result: MediaProcessingResult): Promise<void> {
    this.recorded.push(result);
    return Promise.resolve();
  }
}

let workDirectory: string;
beforeEach(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'verdery-derivative-job-test-'));
});
afterEach(async () => {
  await rm(workDirectory, { recursive: true, force: true });
});

class FileObjectSource implements MediaObjectSource {
  readonly byteLimits: (number | null)[] = [];

  constructor(private readonly buffer: Buffer) {}

  async materialize(
    _bucketName: string,
    _objectKey: string,
    maxBytes: number | null,
  ): Promise<MaterializedMediaObject> {
    this.byteLimits.push(maxBytes);
    const directory = await mkdtemp(join(tmpdir(), 'verdery-derivative-source-'));
    const path = join(directory, 'source');
    await writeFile(path, this.buffer);
    return {
      path,
      byteSize: this.buffer.length,
      checksumSha256: createHash('sha256').update(this.buffer).digest('hex'),
      header: this.buffer.subarray(0, 64 * 1024),
      dispose: async () => rm(directory, { recursive: true, force: true }),
    };
  }
}

class RejectingObjectSource implements MediaObjectSource {
  constructor(private readonly error: Error) {}

  materialize(): Promise<MaterializedMediaObject> {
    return Promise.reject(this.error);
  }
}

class RecordingObjectSink implements DerivativeObjectSink {
  readonly writes: { objectKey: string; buffer: Buffer; contentType: string }[] = [];

  write(objectKey: string, buffer: Buffer, contentType: string): Promise<StoredDerivativeObject> {
    this.writes.push({ objectKey, buffer, contentType });
    return Promise.resolve({
      bucketName: 'derived-bucket',
      objectKey,
      byteSize: buffer.length,
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }
}

function manifest(
  overrides: Partial<MediaProcessingManifest['validation']> = {},
): MediaProcessingManifest {
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
      ...overrides,
    },
    jobKind: 'derivative_generation',
  };
}

/** A one-page PDF poppler can really render — the same fixture the adapter's own suite uses. */
const ONE_PAGE_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n' +
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n' +
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>endobj\n' +
    '4 0 obj<< /Length 44 >>stream\n0 0 1 rg 20 20 160 60 re f\nendstream\nendobj\n' +
    'trailer<< /Root 1 0 R /Size 5 >>\n%%EOF\n',
  'latin1',
);

/** True when `pdftoppm` is on this machine; the deployed image always has it. */
const POPPLER_AVAILABLE = await promisify(execFile)('pdftoppm', ['-v']).then(
  () => true,
  () => false,
);

async function samplePhoto(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#2f6f4f' } })
    .jpeg()
    .toBuffer();
}

describe('ProcessMediaDerivativeGenerationJob', () => {
  it('builds a thumbnail and screen preview for garden_photo, no tile pyramid', async () => {
    const photo = await samplePhoto(2_000, 1_000);
    const sink = new RecordingObjectSink();
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDerivativeGenerationJob(
      new FileObjectSource(photo),
      sink,
      recorder,
      new PopplerPdfPageRasterizer(),
    );

    const result = await job.execute(manifest());

    expect(result.outcome).toBe('succeeded');
    expect(result.outputObjects).toHaveLength(2);
    const kinds = result.outputObjects.map((output) => output.derivativeKind).sort();
    expect(kinds).toEqual(['screen_preview', 'thumbnail']);
    for (const output of result.outputObjects) {
      expect(output.bucketName).toBe('derived-bucket');
      expect(output.contentType).toBe('image/jpeg');
      expect(output.transformationVersion).toBe(1);
      expect(output.tile).toBeUndefined();
    }
    expect(sink.writes).toHaveLength(2);
    expect(recorder.recorded).toEqual([result]);
  });

  it('builds thumbnail, screen preview, high-resolution, and a real tile pyramid for imported_plan (raster)', async () => {
    const plan = await samplePhoto(600, 600); // small enough to keep the test fast
    const sink = new RecordingObjectSink();
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDerivativeGenerationJob(
      new FileObjectSource(plan),
      sink,
      recorder,
      new PopplerPdfPageRasterizer(),
    );

    const result = await job.execute(
      manifest({ mediaClass: 'imported_plan', displayFilename: 'plan.jpg' }),
    );

    expect(result.outcome).toBe('succeeded');
    const kinds = new Set(result.outputObjects.map((output) => output.derivativeKind));
    expect(kinds).toEqual(new Set(['thumbnail', 'screen_preview', 'high_resolution', 'tile']));

    const tiles = result.outputObjects.filter((output) => output.derivativeKind === 'tile');
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.tile).toBeDefined();
      expect(tile.contentType).toBe('image/png');
    }
    // Internally consistent addressing: no two tiles share the same
    // (zoomLevel, x, y).
    const coordinates = new Set(
      tiles.map((tile) => `${tile.tile?.zoomLevel}/${tile.tile?.x}/${tile.tile?.y}`),
    );
    expect(coordinates.size).toBe(tiles.length);
  });

  /*
   * The reported case (2026-08-06): a surveyor's plat arrives as a PDF, and
   * every derivative below this point is pixels. Before ADR-0016 such a plan
   * validated for ever behind a scanner that was never selected, and could
   * not have been rendered anyway — `sharp` has no PDF decoder.
   */
  it.runIf(POPPLER_AVAILABLE)(
    'renders a PDF plan through the same pipeline as a raster one',
    async () => {
      const sink = new RecordingObjectSink();
      const recorder = new RecordingResultRecorder();
      const job = new ProcessMediaDerivativeGenerationJob(
        new FileObjectSource(ONE_PAGE_PDF),
        sink,
        recorder,
        new PopplerPdfPageRasterizer(),
      );

      const result = await job.execute(
        manifest({
          mediaClass: 'imported_plan',
          displayFilename: 'plat.pdf',
          expectedContentType: 'application/pdf',
        }),
      );

      expect(result.outcome).toBe('succeeded');
      expect(new Set(result.outputObjects.map((output) => output.derivativeKind))).toEqual(
        new Set(['thumbnail', 'screen_preview', 'high_resolution', 'tile']),
      );
    },
  );

  // A document the renderer refuses is refused identically on every retry, so
  // it ends the job rather than occupying the queue — the failure mode the
  // never-selected malware scanner used to have.
  it.runIf(POPPLER_AVAILABLE)('fails a corrupt PDF terminally, never retryably', async () => {
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDerivativeGenerationJob(
      new FileObjectSource(Buffer.from('%PDF-1.4 but not really')),
      new RecordingObjectSink(),
      recorder,
      new PopplerPdfPageRasterizer(),
    );

    const result = await job.execute(
      manifest({
        mediaClass: 'imported_plan',
        displayFilename: 'broken.pdf',
        expectedContentType: 'application/pdf',
      }),
    );

    expect(result.outcome).toBe('failed_terminal');
    expect(result.qualityDiagnostics).toMatchObject({ validationCode: 'pdf_render_failed' });
  });

  it('reports the real, worker-computed checksum of the downloaded source as inputChecksums', async () => {
    const photo = await samplePhoto(100, 100);
    const job = new ProcessMediaDerivativeGenerationJob(
      new FileObjectSource(photo),
      new RecordingObjectSink(),
      new RecordingResultRecorder(),
      new PopplerPdfPageRasterizer(),
    );

    const result = await job.execute(manifest());

    expect(result.inputChecksums).toEqual([createHash('sha256').update(photo).digest('hex')]);
  });

  it('bounds an unlimited-size garden photo re-download to its already validated byte size', async () => {
    const photo = await samplePhoto(100, 100);
    const source = new FileObjectSource(photo);
    const job = new ProcessMediaDerivativeGenerationJob(
      source,
      new RecordingObjectSink(),
      new RecordingResultRecorder(),
      new PopplerPdfPageRasterizer(),
    );

    await job.execute(manifest({ expectedByteSize: photo.length }));

    expect(source.byteLimits).toEqual([photo.length]);
  });

  it('is a terminal failure, not a thrown error, for a media class with no derivative profile', async () => {
    const photo = await samplePhoto(100, 100);
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDerivativeGenerationJob(
      new FileObjectSource(photo),
      new RecordingObjectSink(),
      recorder,
      new PopplerPdfPageRasterizer(),
    );

    const result = await job.execute(manifest({ mediaClass: 'raw_capture' }));

    expect(result.outcome).toBe('failed_terminal');
    expect(result.resultSummary).toMatchObject({ validationCode: 'derivative_profile_missing' });
    expect(recorder.recorded).toEqual([result]);
  });

  it('converts a real ObjectTooLargeError into a failed_terminal result instead of throwing', async () => {
    const recorder = new RecordingResultRecorder();
    const job = new ProcessMediaDerivativeGenerationJob(
      new RejectingObjectSource(new ObjectTooLargeError(99_999_999, 50 * 1024 * 1024)),
      new RecordingObjectSink(),
      recorder,
      new PopplerPdfPageRasterizer(),
    );

    const result = await job.execute(manifest());

    expect(result.outcome).toBe('failed_terminal');
    expect(result.resultSummary).toMatchObject({ validationCode: 'byte_size_limit_exceeded' });
    expect(recorder.recorded).toEqual([result]);
  });

  it('propagates an unrelated error uncaught, so the caller answers retryably', async () => {
    const job = new ProcessMediaDerivativeGenerationJob(
      new RejectingObjectSource(new Error('object storage temporarily unavailable')),
      new RecordingObjectSink(),
      new RecordingResultRecorder(),
      new PopplerPdfPageRasterizer(),
    );

    await expect(job.execute(manifest())).rejects.toThrow('object storage temporarily unavailable');
  });
});
