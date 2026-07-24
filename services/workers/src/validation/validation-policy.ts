export interface ValidationPolicy {
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number;
  readonly maxImagePixels: number;
  readonly maxImageDimension: number;
  readonly maxPdfPages: number;
  readonly malwareScanRequired: boolean;
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

const BASE: Omit<ValidationPolicy, 'allowedContentTypes' | 'maxBytes' | 'malwareScanRequired'> = {
  maxImagePixels: 40_000_000,
  maxImageDimension: 16_384,
  maxPdfPages: 100,
};

/**
 * `raw_capture` (Garden Scan video, AR artifacts, depth data — architecture/
 * media-storage-and-processing.md section "3. Media Classes") deliberately
 * has NO entry here: video duration/codec/frame-rate validation (section
 * "10. Video Handling") needs `ffprobe`, a native binary dependency
 * explicitly out of scope for this stage — see `media-validator.ts`'s own
 * header comment. `process-media-validation-job.ts` recognizes
 * `raw_capture` and never calls into this module or `MediaValidator` for it
 * at all, so `policyFor('raw_capture')` returning `null` is never actually
 * reached in that path; it stays `null` here (rather than a fabricated
 * policy) so a genuinely unexpected/future media class and `raw_capture`
 * cannot be confused with each other by an unrelated caller.
 */
const POLICIES: Readonly<Record<string, ValidationPolicy>> = {
  garden_photo: {
    ...BASE,
    allowedContentTypes: IMAGE_TYPES,
    maxBytes: 25 * MIB,
    malwareScanRequired: false,
  },
  imported_plan: {
    ...BASE,
    allowedContentTypes: [...IMAGE_TYPES, 'application/pdf'],
    maxBytes: 50 * MIB,
    malwareScanRequired: true,
  },
  derived_preview: {
    ...BASE,
    allowedContentTypes: IMAGE_TYPES,
    maxBytes: 50 * MIB,
    malwareScanRequired: false,
  },
  processing_output: {
    ...BASE,
    allowedContentTypes: [...IMAGE_TYPES, 'application/pdf'],
    maxBytes: GIB,
    malwareScanRequired: true,
  },
  export_package: {
    ...BASE,
    allowedContentTypes: [],
    maxBytes: 2 * GIB,
    malwareScanRequired: true,
  },
};

/** `null` for `raw_capture` and for any media class this policy table does not (yet) recognize — see this file's own comment on `POLICIES` for the `raw_capture` case specifically. */
export function policyFor(mediaClass: string): ValidationPolicy | null {
  return POLICIES[mediaClass] ?? null;
}

const EXTENSIONS_BY_CONTENT_TYPE: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'application/pdf': ['pdf'],
};

export function filenameMatchesContentType(filename: string, contentType: string): boolean {
  const separator = filename.lastIndexOf('.');
  if (separator < 0 || separator === filename.length - 1) {
    return false;
  }
  const extension = filename.slice(separator + 1).toLowerCase();
  return EXTENSIONS_BY_CONTENT_TYPE[contentType]?.includes(extension) ?? false;
}
