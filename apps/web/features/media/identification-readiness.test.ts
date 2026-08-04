import { IDENTIFIABLE_PHOTO_MAX_BYTES } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { photoReadyForIdentification, type IdentifiableUpload } from './identification-readiness';

function upload(overrides: Partial<IdentifiableUpload> = {}): IdentifiableUpload {
  return {
    uploadState: 'available',
    declaredByteSize: 2_000_000,
    verifiedByteSize: null,
    ...overrides,
  };
}

describe('photoReadyForIdentification', () => {
  it('is false before the bytes have landed', () => {
    expect(photoReadyForIdentification(null, 'uploading')).toBe(false);
    expect(photoReadyForIdentification(upload({ uploadState: 'uploading' }), 'uploading')).toBe(
      false,
    );
  });

  it('does not wait for processing when the provider can read the original', () => {
    expect(photoReadyForIdentification(upload(), 'processing')).toBe(true);
  });

  // The reported defect: a phone original the provider refuses, identified
  // the instant it was stored, before any derivative existed.
  it('waits for processing when the original is larger than the provider accepts', () => {
    const oversized = upload({ declaredByteSize: IDENTIFIABLE_PHOTO_MAX_BYTES + 1 });

    expect(photoReadyForIdentification(oversized, 'processing')).toBe(false);
    expect(photoReadyForIdentification(oversized, 'processed')).toBe(true);
  });

  // Waiting forever is worse than identifying nothing: once processing has
  // failed, no derivative is coming, and the flow must still finish.
  it('stops waiting once processing has failed', () => {
    const oversized = upload({ declaredByteSize: IDENTIFIABLE_PHOTO_MAX_BYTES + 1 });

    expect(photoReadyForIdentification(oversized, 'processingFailed')).toBe(true);
  });

  it('believes the verified size over the declared one', () => {
    const misdeclared = upload({
      declaredByteSize: 1_000,
      verifiedByteSize: IDENTIFIABLE_PHOTO_MAX_BYTES + 1,
    });

    expect(photoReadyForIdentification(misdeclared, 'processing')).toBe(false);
  });

  it('treats the limit itself as readable', () => {
    expect(
      photoReadyForIdentification(
        upload({ declaredByteSize: IDENTIFIABLE_PHOTO_MAX_BYTES }),
        'processing',
      ),
    ).toBe(true);
  });
});
