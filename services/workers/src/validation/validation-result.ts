export type MalwareScanStatus = 'clean' | 'malicious' | 'not_required' | 'unavailable';

/**
 * `'video'` is deliberately not a member of `kind`: video/raw-capture
 * metadata parsing (duration, codec, frame rate) is out of scope for this
 * stage — see `media-validator.ts`'s own header comment.
 */
export interface ValidationMetadata {
  readonly kind: 'image' | 'pdf';
  readonly width?: number;
  readonly height?: number;
  readonly pageCount?: number;
  readonly orientation?: number;
}

export interface ValidatedMedia {
  readonly accepted: true;
  readonly detectedContentType: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly metadata: ValidationMetadata;
  readonly malwareScan: MalwareScanStatus;
}

export interface RejectedMedia {
  readonly accepted: false;
  readonly code: string;
  readonly detectedContentType: string | null;
  readonly byteSize: number;
  readonly checksumSha256: string | null;
  readonly metadata: ValidationMetadata | null;
  readonly malwareScan: MalwareScanStatus;
}

export type MediaValidationResult = ValidatedMedia | RejectedMedia;

export interface MalwareScanResult {
  readonly status: MalwareScanStatus;
  readonly provider: string | null;
}

export interface MalwareScanner {
  scan(path: string, contentType: string): Promise<MalwareScanResult>;
}

/**
 * Explicit safe placeholder until a malware provider is selected. Documents
 * are not silently labelled clean: the orchestrator converts `unavailable`
 * into a retryable worker failure.
 */
export class UnavailableMalwareScanner implements MalwareScanner {
  scan(): Promise<MalwareScanResult> {
    return Promise.resolve({ status: 'unavailable', provider: null });
  }
}

export class MalwareScanUnavailableError extends Error {
  constructor() {
    super('The required malware scanner is unavailable.');
    this.name = 'MalwareScanUnavailableError';
  }
}
