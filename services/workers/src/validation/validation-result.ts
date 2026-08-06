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
}

export interface RejectedMedia {
  readonly accepted: false;
  readonly code: string;
  readonly detectedContentType: string | null;
  readonly byteSize: number;
  readonly checksumSha256: string | null;
  readonly metadata: ValidationMetadata | null;
}

export type MediaValidationResult = ValidatedMedia | RejectedMedia;
