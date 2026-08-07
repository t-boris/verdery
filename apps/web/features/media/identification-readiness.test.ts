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

  it('does not impose an identification limit on large originals', () => {
    const largeOriginal = upload({ declaredByteSize: 80_000_000, verifiedByteSize: 80_000_000 });

    expect(photoReadyForIdentification(largeOriginal, 'processing')).toBe(true);
    expect(photoReadyForIdentification(largeOriginal, 'processingFailed')).toBe(true);
  });
});
