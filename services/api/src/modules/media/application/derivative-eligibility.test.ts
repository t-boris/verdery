import { describe, expect, it } from 'vitest';
import { deriveEligibleDerivativeSourceContentType } from './derivative-eligibility.js';

describe('deriveEligibleDerivativeSourceContentType', () => {
  it('is eligible for a garden_photo detected as an accepted raster type', () => {
    expect(
      deriveEligibleDerivativeSourceContentType('garden_photo', {
        detectedContentType: 'image/jpeg',
      }),
    ).toBe('image/jpeg');
    expect(
      deriveEligibleDerivativeSourceContentType('garden_photo', {
        detectedContentType: 'image/heic',
      }),
    ).toBe('image/heic');
  });

  it('is eligible for a raster imported_plan', () => {
    expect(
      deriveEligibleDerivativeSourceContentType('imported_plan', {
        detectedContentType: 'image/png',
      }),
    ).toBe('image/png');
  });

  it('is not eligible for a PDF-classed imported_plan (out of scope this stage)', () => {
    expect(
      deriveEligibleDerivativeSourceContentType('imported_plan', {
        detectedContentType: 'application/pdf',
      }),
    ).toBeNull();
  });

  it('is not eligible for raw_capture, regardless of detectedContentType', () => {
    expect(
      deriveEligibleDerivativeSourceContentType('raw_capture', {
        detectedContentType: 'image/jpeg',
      }),
    ).toBeNull();
  });

  it('is not eligible for derived_preview/processing_output/export_package', () => {
    for (const mediaClass of ['derived_preview', 'processing_output', 'export_package']) {
      expect(
        deriveEligibleDerivativeSourceContentType(mediaClass, {
          detectedContentType: 'image/jpeg',
        }),
      ).toBeNull();
    }
  });

  it('returns null when detectedContentType is missing or not a string', () => {
    expect(deriveEligibleDerivativeSourceContentType('garden_photo', {})).toBeNull();
    expect(
      deriveEligibleDerivativeSourceContentType('garden_photo', { detectedContentType: 42 }),
    ).toBeNull();
  });
});
