/**
 * When an uploaded photo is ready to be *identified*, not merely stored.
 *
 * `uploadState === 'available'` is the server's precondition for attaching a
 * photo, and for most photos it is also the moment identification can run.
 * Original size is not a client-side identification gate. The API selects a
 * generated analysis rendition when needed and returns a retryable response
 * while it is still being prepared. The mutation owns that retry, so this
 * helper only answers the storage precondition shared by every photo.
 *
 * Source: architecture/media-storage-and-processing.md, section "6.
 * Derivatives"; architecture/external-integrations.md, section "3. Adapter
 * Contract".
 */

import type { Media } from '@verdery/api-contracts';

import type { MediaUploadPhase } from './media-upload-controller';

/** The part of a `Media` this decision reads. `Media` is assignable. */
export interface IdentifiableUpload {
  readonly uploadState: Media['uploadState'];
  readonly declaredByteSize: number;
  readonly verifiedByteSize: number | null;
}

export function photoReadyForIdentification(
  media: IdentifiableUpload | null,
  _phase: MediaUploadPhase,
): boolean {
  return media !== null && media.uploadState === 'available';
}
