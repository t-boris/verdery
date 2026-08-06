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

  /*
   * ADR-0017: a plan PDF is rendered by the worker (first page, `poppler`)
   * and follows the raster path from there. This list excluding PDF is what
   * made a real surveyor's plat upload, validate, and produce nothing.
   */
  it('is eligible for a PDF-classed imported_plan', () => {
    expect(
      deriveEligibleDerivativeSourceContentType('imported_plan', {
        detectedContentType: 'application/pdf',
      }),
    ).toBe('application/pdf');
  });

  // Only plans. No PDF garden photo is accepted at upload, so treating one as
  // eligible here would be inventing a case the product does not have.
  it('is not eligible for a PDF-classed garden_photo', () => {
    expect(
      deriveEligibleDerivativeSourceContentType('garden_photo', {
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
