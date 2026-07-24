import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import { ObjectTooLargeError } from './media-object-source.js';
import type { MediaProcessingResultRecorder } from './media-processing-result-recorder.js';
import type { MediaValidator } from './media-validator.js';

const PROCESSOR_VERSION = 'media-validator-v1';

/**
 * Video/raw-capture duration, codec, and frame-rate validation (architecture/
 * media-storage-and-processing.md section "10. Video Handling") is
 * deliberately out of scope for this stage — see `media-validator.ts`'s own
 * header comment for why (it needs `ffprobe`, a native binary dependency not
 * yet in this stack). A `raw_capture` manifest is recognized and short-
 * circuited HERE, before `MediaValidator`/`validation-policy.ts` is ever
 * consulted: no bytes are downloaded, no `file-type`/`image-size` parser
 * runs, and the job is recorded as `succeeded` unconditionally, preserving
 * exactly the declared-metadata-trusted level P6-API-01's `CompleteMediaUpload`
 * already established for video before this stage existed. This is NOT the
 * same as `validation-policy.ts`'s `validation_policy_missing` rejection
 * path (reserved for a genuinely unexpected/unrecognized media class) —
 * conflating the two would silently start rejecting every video upload the
 * moment this stage shipped, a real regression this module must not
 * introduce.
 */
const VIDEO_VALIDATION_DEFERRED_NOTE =
  'Video/raw-capture deep validation (duration, codec, frame rate) is out of ' +
  'scope for this stage (architecture/media-storage-and-processing.md section ' +
  '10; needs ffprobe, a native binary dependency deliberately deferred). ' +
  'Accepted at the same declared-metadata-trusted level P6-API-01 already ' +
  'established, without downloading or inspecting object bytes.';

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
    resultSummary: { accepted: false, validationCode: code },
    qualityDiagnostics: { validationCode: code },
    resourceMetrics: { durationMs },
    outcome: 'failed_terminal',
  };
}

function videoValidationDeferred(
  manifest: MediaProcessingManifest,
  durationMs: number,
): MediaProcessingResult {
  return {
    jobId: manifest.jobId,
    processorVersion: PROCESSOR_VERSION,
    inputChecksums: manifest.expectedChecksums,
    outputObjects: [],
    resultSummary: { accepted: true, validationCode: 'video_validation_deferred' },
    qualityDiagnostics: { note: VIDEO_VALIDATION_DEFERRED_NOTE },
    resourceMetrics: { durationMs },
    outcome: 'succeeded',
  };
}

export class ProcessMediaValidationJob {
  constructor(
    private readonly validator: MediaValidator,
    private readonly results: MediaProcessingResultRecorder,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult> {
    const startedAt = this.now();

    if (manifest.validation.mediaClass === 'raw_capture') {
      const result = videoValidationDeferred(manifest, Math.max(0, this.now() - startedAt));
      await this.results.record(result);
      return result;
    }

    let result: MediaProcessingResult;
    try {
      const validation = await this.validator.validate(manifest);
      const durationMs = Math.max(0, this.now() - startedAt);
      result = {
        jobId: manifest.jobId,
        processorVersion: PROCESSOR_VERSION,
        inputChecksums: validation.checksumSha256 === null ? [] : [validation.checksumSha256],
        outputObjects: [],
        resultSummary: {
          accepted: validation.accepted,
          detectedContentType: validation.detectedContentType,
          byteSize: validation.byteSize,
          metadata: validation.metadata,
          malwareScan: validation.malwareScan,
          ...(!validation.accepted ? { validationCode: validation.code } : {}),
        },
        qualityDiagnostics: validation.accepted ? null : { validationCode: validation.code },
        resourceMetrics: { durationMs },
        outcome: validation.accepted ? 'succeeded' : 'failed_terminal',
      };
    } catch (error) {
      if (!(error instanceof ObjectTooLargeError)) {
        throw error;
      }
      result = terminalFailure(manifest, 'byte_size_limit_exceeded', this.now() - startedAt);
    }

    await this.results.record(result);
    return result;
  }
}
