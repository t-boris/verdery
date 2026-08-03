/**
 * Orchestrates one `derivative_generation` job: downloads the already-
 * validated source object (reusing `../validation/media-object-source.ts`'s
 * port — validated bytes are just as sensitive as unvalidated ones and
 * deserve the same isolated-temp-directory materialization, even though
 * this stage trusts their CONTENT more than P6-WORKER-01 did), builds every
 * derivative `derivative-profile.ts`'s `derivativeProfileFor` names for
 * this media class, writes each one to the derived bucket, and assembles a
 * `MediaProcessingResult` whose `outputObjects` carry everything
 * `services/api`'s `record-media-processing-result.ts` needs to register
 * each as its own new `media_record` row (see that file's own header
 * comment, and `@verdery/api-contracts`' `MediaProcessingOutputObject` doc
 * comment for the exact fields).
 *
 * Mirrors `../validation/process-media-validation-job.ts`'s own shape
 * (`execute(manifest)`, records the result, returns it) closely enough that
 * `MediaProcessingJobRouter` can treat both interchangeably.
 */

import type {
  MediaDerivativeKind,
  MediaDerivativeTileCoordinates,
  MediaProcessingManifest,
  MediaProcessingOutputObject,
  MediaProcessingResult,
} from '@verdery/api-contracts';
import { ObjectTooLargeError } from '../validation/media-object-source.js';
import type { MediaObjectSource } from '../validation/media-object-source.js';
import type { MediaProcessingResultRecorder } from '../validation/media-processing-result-recorder.js';
import { generateDerivativeObjectKey } from './derivative-object-key.js';
import type { DerivativeObjectSink } from './derivative-object-sink.js';
import {
  DERIVATIVE_TRANSFORMATION_VERSION,
  derivativeProfileFor,
  planTilePyramid,
} from './derivative-profile.js';
import { decodeAndOrient, resizeRasterDerivative } from './image-derivative-generator.js';
import { computePerceptualHash } from './perceptual-hash.js';
import { generateTilePyramid } from './tile-pyramid-generator.js';

const PROCESSOR_VERSION = 'media-derivative-generator-v1';

/**
 * Defense-in-depth re-download ceiling: this manifest's own source has
 * already passed `media_validation`'s own class-specific byte ceiling once
 * (`../validation/validation-policy.ts`). 50 MiB is that policy's own
 * `imported_plan` number — the larger of the two derivative-eligible
 * classes' ceilings — reused here rather than inventing a second figure,
 * matching this stage's own "reuse an existing number before minting a new
 * one" posture elsewhere (`derivative-eligibility.ts`'s content-type list,
 * this file's own `PROCESSOR_VERSION` naming convention).
 */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

function terminalFailure(
  manifest: MediaProcessingManifest,
  code: string,
  durationMs: number,
): MediaProcessingResult {
  return {
    jobId: manifest.jobId,
    processorVersion: PROCESSOR_VERSION,
    inputChecksums: [],
    outputObjects: [],
    resultSummary: { derivativeCount: 0, validationCode: code },
    qualityDiagnostics: { validationCode: code },
    resourceMetrics: { durationMs },
    outcome: 'failed_terminal',
  };
}

export class ProcessMediaDerivativeGenerationJob {
  constructor(
    private readonly source: MediaObjectSource,
    private readonly sink: DerivativeObjectSink,
    private readonly results: MediaProcessingResultRecorder,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult> {
    const startedAt = this.now();
    let result: MediaProcessingResult;
    try {
      result = await this.generate(manifest, startedAt);
    } catch (error) {
      if (!(error instanceof ObjectTooLargeError)) {
        throw error;
      }
      result = terminalFailure(
        manifest,
        'byte_size_limit_exceeded',
        Math.max(0, this.now() - startedAt),
      );
    }

    await this.results.record(result);
    return result;
  }

  private async generate(
    manifest: MediaProcessingManifest,
    startedAt: number,
  ): Promise<MediaProcessingResult> {
    const profile = derivativeProfileFor(manifest.validation.mediaClass);
    const input = manifest.inputObjects[0];
    if (profile === null || input === undefined) {
      return terminalFailure(
        manifest,
        'derivative_profile_missing',
        Math.max(0, this.now() - startedAt),
      );
    }

    const object = await this.source.materialize(
      input.bucketName,
      input.objectKey,
      MAX_SOURCE_BYTES,
    );
    try {
      const oriented = await decodeAndOrient(object.path);
      const outputs: MediaProcessingOutputObject[] = [];

      for (const spec of profile.rasterSpecs) {
        const generated = await resizeRasterDerivative(
          oriented,
          spec.maxDimensionPx,
          spec.jpegQuality,
        );
        outputs.push(
          await this.storeOutput(
            manifest.mediaId,
            generated.buffer,
            generated.contentType,
            spec.kind,
            null,
          ),
        );
      }

      if (profile.includeTilePyramid) {
        const levels = planTilePyramid(oriented.width, oriented.height);
        const tiles = await generateTilePyramid(oriented, levels);
        for (const tile of tiles) {
          outputs.push(
            await this.storeOutput(manifest.mediaId, tile.buffer, tile.contentType, 'tile', {
              zoomLevel: tile.zoomLevel,
              x: tile.x,
              y: tile.y,
            }),
          );
        }
      }

      return {
        jobId: manifest.jobId,
        processorVersion: PROCESSOR_VERSION,
        // The real checksum of the bytes THIS job actually downloaded and
        // decoded — `services/api`'s `requireSuccessfulInputChecksums`
        // compares this against the manifest's own `expectedChecksums`
        // (the real, validation-computed checksum `derivative-
        // eligibility.ts`'s triggering outbox event carried), proving this
        // derivative job processed the exact bytes it was told to.
        inputChecksums: [object.checksumSha256],
        outputObjects: outputs,
        resultSummary: {
          derivativeCount: outputs.length,
          sourceWidth: oriented.width,
          sourceHeight: oriented.height,
        },
        qualityDiagnostics: null,
        resourceMetrics: { durationMs: Math.max(0, this.now() - startedAt) },
        outcome: 'succeeded',
        // Hashed from the one clean decode this job already performed —
        // computing it anywhere else would mean downloading and decoding
        // the same object a second time.
        sourcePerceptualHash: await computePerceptualHash(oriented.buffer),
      };
    } finally {
      await object.dispose();
    }
  }

  private async storeOutput(
    sourceMediaId: string,
    buffer: Buffer,
    contentType: string,
    derivativeKind: MediaDerivativeKind,
    tile: MediaDerivativeTileCoordinates | null,
  ): Promise<MediaProcessingOutputObject> {
    const objectKey = generateDerivativeObjectKey(sourceMediaId);
    const stored = await this.sink.write(objectKey, buffer, contentType);

    return {
      bucketName: stored.bucketName,
      objectKey: stored.objectKey,
      checksumSha256: stored.checksumSha256,
      contentType,
      byteSize: stored.byteSize,
      derivativeKind,
      transformationVersion: DERIVATIVE_TRANSFORMATION_VERSION,
      ...(tile === null ? {} : { tile }),
    };
  }
}
