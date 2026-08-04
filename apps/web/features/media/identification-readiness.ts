/**
 * When an uploaded photo is ready to be *identified*, not merely stored.
 *
 * `uploadState === 'available'` is the server's precondition for attaching a
 * photo, and for most photos it is also the moment identification can run.
 * It is not the moment for a large one: a phone original is routinely bigger
 * than the vision provider accepts, and the smaller display derivative that
 * does fit only exists once processing has finished. Creating the plant the
 * instant the bytes land therefore identified nothing and showed no picture —
 * the person got "Unidentified candidate" with an empty frame and no reason
 * why (reported 2026-08-04).
 *
 * Waiting is scoped to exactly that case. `add-plant-from-photo-panel.tsx`
 * deliberately did not gate on processing, because a development environment
 * without the processing worker can sit in `processing` forever and strand
 * the flow; that reasoning still holds for every photo the provider can read
 * as it is, which is the overwhelming majority.
 *
 * Source: architecture/media-storage-and-processing.md, section "6.
 * Derivatives"; architecture/external-integrations.md, section "3. Adapter
 * Contract".
 */

import { IDENTIFIABLE_PHOTO_MAX_BYTES, type Media } from '@verdery/api-contracts';

import type { MediaUploadPhase } from './media-upload-controller';

/** The part of a `Media` this decision reads. `Media` is assignable. */
export interface IdentifiableUpload {
  readonly uploadState: Media['uploadState'];
  readonly declaredByteSize: number;
  readonly verifiedByteSize: number | null;
}

/** Processing has settled: a derivative either exists now or never will. */
const SETTLED_PROCESSING_PHASES = new Set<MediaUploadPhase>(['processed', 'processingFailed']);

export function photoReadyForIdentification(
  media: IdentifiableUpload | null,
  phase: MediaUploadPhase,
): boolean {
  if (media === null || media.uploadState !== 'available') {
    return false;
  }
  // The verified size, like the server's own choice of analysis source: it is
  // what the object really weighs, where the declared one is what a client said.
  const byteSize = media.verifiedByteSize ?? media.declaredByteSize;
  if (byteSize <= IDENTIFIABLE_PHOTO_MAX_BYTES) {
    return true;
  }
  return SETTLED_PROCESSING_PHASES.has(phase);
}
