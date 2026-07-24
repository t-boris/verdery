import type { MediaProcessingManifest } from '@verdery/api-contracts';
import { detectContentType } from './content-signature.js';
import { parseImageMetadata } from './image-metadata-parser.js';
import type { MediaObjectSource, MaterializedMediaObject } from './media-object-source.js';
import { ActivePdfContentError, parsePdfMetadata } from './pdf-metadata-parser.js';
import {
  filenameMatchesContentType,
  policyFor,
  type ValidationPolicy,
} from './validation-policy.js';
import {
  MalwareScanUnavailableError,
  type MalwareScanner,
  type MediaValidationResult,
  type ValidationMetadata,
} from './validation-result.js';

/**
 * OUT OF SCOPE, DELIBERATELY: video/raw-capture duration, codec, and frame-rate
 * validation (architecture/media-storage-and-processing.md section
 * "10. Video Handling"). That needs `ffprobe`, a native binary dependency not
 * yet in this stack — the exact class of dependency `content-signature.ts`
 * and `image-metadata-parser.ts` both deliberately avoid for images by
 * picking pure-JS `file-type`/`image-size` over `sharp`. Accepting a native
 * decoder for images while refusing one for video would be an inconsistent,
 * undocumented fork of the same reasoning, so this module never attempts
 * video parsing at all — `process-media-validation-job.ts` short-circuits a
 * `raw_capture` manifest before this validator (or `validation-policy.ts`,
 * which has no entry for `raw_capture`) is ever consulted, preserving
 * P6-API-01's existing declared-metadata-trusted level for video uploads
 * unchanged. See that file's own header comment for the full reasoning.
 */

function rejected(
  object: MaterializedMediaObject,
  code: string,
  detectedContentType: string | null,
  metadata: ValidationMetadata | null = null,
): MediaValidationResult {
  return {
    accepted: false,
    code,
    detectedContentType,
    byteSize: object.byteSize,
    checksumSha256: object.checksumSha256,
    metadata,
    malwareScan: 'not_required',
  };
}

async function parseMetadata(
  object: MaterializedMediaObject,
  contentType: string,
  policy: ValidationPolicy,
): Promise<ValidationMetadata> {
  if (contentType.startsWith('image/')) {
    // Header-only, never a full decode — see image-metadata-parser.ts's own
    // header comment for why `object.header` (not `object.path`) is correct
    // here.
    return parseImageMetadata(object.header, policy.maxImagePixels, policy.maxImageDimension);
  }
  if (contentType === 'application/pdf') {
    return parsePdfMetadata(object.path, policy.maxPdfPages);
  }
  throw new Error('No constrained parser exists for this content type.');
}

export class MediaValidator {
  constructor(
    private readonly source: MediaObjectSource,
    private readonly malwareScanner: MalwareScanner,
  ) {}

  async validate(manifest: MediaProcessingManifest): Promise<MediaValidationResult> {
    const policy = policyFor(manifest.validation.mediaClass);
    if (policy === null || manifest.inputObjects.length !== 1) {
      return {
        accepted: false,
        code: 'validation_policy_missing',
        detectedContentType: null,
        byteSize: 0,
        checksumSha256: null,
        metadata: null,
        malwareScan: 'not_required',
      };
    }

    const input = manifest.inputObjects[0];
    if (input === undefined) {
      throw new Error('The validation manifest has no input object.');
    }
    const object = await this.source.materialize(
      input.bucketName,
      input.objectKey,
      policy.maxBytes,
    );
    try {
      return await this.validateMaterialized(manifest, policy, object);
    } finally {
      await object.dispose();
    }
  }

  private async validateMaterialized(
    manifest: MediaProcessingManifest,
    policy: ValidationPolicy,
    object: MaterializedMediaObject,
  ): Promise<MediaValidationResult> {
    const detectedContentType = await detectContentType(object.header);
    if (
      detectedContentType === null ||
      !policy.allowedContentTypes.includes(detectedContentType) ||
      detectedContentType !== manifest.validation.expectedContentType
    ) {
      return rejected(object, 'content_type_mismatch', detectedContentType);
    }
    if (object.byteSize !== manifest.validation.expectedByteSize) {
      return rejected(object, 'byte_size_mismatch', detectedContentType);
    }
    if (!filenameMatchesContentType(manifest.validation.displayFilename, detectedContentType)) {
      return rejected(object, 'filename_extension_mismatch', detectedContentType);
    }
    if (
      manifest.expectedChecksums.length > 0 &&
      !manifest.expectedChecksums.includes(object.checksumSha256)
    ) {
      return rejected(object, 'checksum_mismatch', detectedContentType);
    }

    let metadata: ValidationMetadata;
    try {
      metadata = await parseMetadata(object, detectedContentType, policy);
    } catch (error) {
      const code =
        error instanceof ActivePdfContentError ? 'active_content_rejected' : 'malformed_file';
      return rejected(object, code, detectedContentType);
    }

    const scanRequired = policy.malwareScanRequired && detectedContentType === 'application/pdf';
    if (!scanRequired) {
      return {
        accepted: true,
        detectedContentType,
        byteSize: object.byteSize,
        checksumSha256: object.checksumSha256,
        metadata,
        malwareScan: 'not_required',
      };
    }

    const scan = await this.malwareScanner.scan(object.path, detectedContentType);
    if (scan.status === 'unavailable') {
      throw new MalwareScanUnavailableError();
    }
    if (scan.status !== 'clean') {
      return {
        ...rejected(object, 'malware_detected', detectedContentType, metadata),
        malwareScan: scan.status,
      };
    }

    return {
      accepted: true,
      detectedContentType,
      byteSize: object.byteSize,
      checksumSha256: object.checksumSha256,
      metadata,
      malwareScan: 'clean',
    };
  }
}
