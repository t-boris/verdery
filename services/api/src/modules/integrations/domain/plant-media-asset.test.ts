import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  createPlantMediaAsset,
  isLicenseEligibleForPresentation,
  parseProviderLicense,
  presentationIneligibility,
} from './plant-media-asset.js';

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
  it('refuses CC-BY that cannot be attributed, which the licence check alone cannot see', () => {
    // CC-BY grants use ON CONDITION of attribution: an image this
    // application cannot credit may not be shown, even though the licence
    // itself is on the allowlist.
    expect(presentationIneligibility('cc_by', null)).toBe('rights_holder_absent');
    expect(presentationIneligibility('cc_by', '   ')).toBe('rights_holder_absent');
    expect(presentationIneligibility('cc_by', 'A. Botanist')).toBeNull();
  });

  it('needs no rights holder for licences that impose no attribution condition', () => {
    expect(presentationIneligibility('cc0', null)).toBeNull();
    expect(presentationIneligibility('public_domain', null)).toBeNull();
  });

  it('names the refusal, because the responses differ', () => {
    // ShareAlike is expected to reverse once a compliance design exists;
    // non-commercial never will.
    expect(presentationIneligibility('cc_by_nc', 'A. Botanist')).toBe('non_commercial');
    expect(presentationIneligibility('cc_by_sa', 'A. Botanist')).toBe(
      'share_alike_pending_compliance_design',
    );
    expect(presentationIneligibility('withdrawn', 'A. Botanist')).toBe('withdrawn');
    expect(presentationIneligibility('unknown', 'A. Botanist')).toBe('license_unknown');
  });
});

describe('parseProviderLicense', () => {
  it('reads the GBIF URL forms', () => {
    expect(parseProviderLicense('http://creativecommons.org/publicdomain/zero/1.0/')).toBe('cc0');
    expect(parseProviderLicense('http://creativecommons.org/licenses/by/4.0/')).toBe('cc_by');
    expect(parseProviderLicense('http://creativecommons.org/licenses/by-nc/4.0/')).toBe('cc_by_nc');
  });

  it('reads a ShareAlike-plus-NonCommercial licence as non-commercial', () => {
    expect(parseProviderLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(
      'cc_by_nc',
    );
  });

  it('reads the same licence written several ways', () => {
    for (const spelling of [
      'HTTPS://creativecommons.org/publicdomain/zero/1.0',
      'http://creativecommons.org/publicdomain/zero/1.0/',
      '  cc0-1.0  ',
    ]) {
      expect(parseProviderLicense(spelling)).toBe('cc0');
    }
  });

  it('records an unreadable licence as unknown rather than dropping the asset', () => {
    // Stored honestly and then refused, so "how many did we refuse, and
    // why" stays answerable.
    for (const absent of [null, undefined, '', '   ', 'http://example.org/bespoke-terms']) {
      expect(parseProviderLicense(absent)).toBe('unknown');
    }
  });
});
