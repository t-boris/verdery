import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createPlantMediaAsset, isLicenseEligibleForPresentation } from './plant-media-asset.js';

const ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-29T12:00:00Z');

function baseInput() {
  return {
    id: ID,
    rawProviderTaxonId: 'PROV-123',
    mediaId: null,
    sourceUrl: 'https://example.org/fig.jpg',
    organ: null,
    inferredOrgan: false,
    rawLicense: 'cc_by',
    attributionText: null,
    creator: null,
    rightsHolder: null,
    observedAt: null,
    generalizedLocation: null,
    ingestionState: 'discovered' as const,
    now: NOW,
  };
}

describe('createPlantMediaAsset', () => {
  it('creates a discovered asset with only a source URL', () => {
    const asset = createPlantMediaAsset(baseInput());
    expect(asset.ingestionState).toBe('discovered');
    expect(asset.mediaId).toBeNull();
  });

  it('rejects an asset with neither mediaId nor sourceUrl', () => {
    expect(() => createPlantMediaAsset({ ...baseInput(), sourceUrl: null })).toThrow(
      ValidationError,
    );
  });

  it('rejects an unrecognized organ', () => {
    expect(() => createPlantMediaAsset({ ...baseInput(), organ: 'root' as never })).toThrow(
      ValidationError,
    );
  });

  it('rejects an unrecognized license', () => {
    expect(() =>
      createPlantMediaAsset({ ...baseInput(), rawLicense: 'all_rights_reserved' }),
    ).toThrow(ValidationError);
  });

  it('rejects ingestionState ingested with no mediaId', () => {
    expect(() => createPlantMediaAsset({ ...baseInput(), ingestionState: 'ingested' })).toThrow(
      ValidationError,
    );
  });

  it('accepts an ingested asset with a mediaId', () => {
    const asset = createPlantMediaAsset({
      ...baseInput(),
      mediaId: MEDIA_ID,
      ingestionState: 'ingested',
    });
    expect(asset.mediaId).toBe(MEDIA_ID);
  });
});

describe('isLicenseEligibleForPresentation', () => {
  it.each(['public_domain', 'cc0', 'cc_by'] as const)('accepts %s', (license) => {
    expect(isLicenseEligibleForPresentation(license)).toBe(true);
  });

  it.each(['cc_by_sa', 'cc_by_nc', 'unknown', 'withdrawn'] as const)('rejects %s', (license) => {
    expect(isLicenseEligibleForPresentation(license)).toBe(false);
  });
});
