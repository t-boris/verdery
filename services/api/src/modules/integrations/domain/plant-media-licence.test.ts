/**
 * Tests for the taxon-image licence rules.
 *
 * Written as licence questions rather than string-parsing ones: the cost of
 * getting one wrong is showing an image this product has no right to show.
 */

import { describe, expect, it } from 'vitest';
import { decidePlantMediaEligibility, parseProviderLicence } from './plant-media-licence.js';

describe('decidePlantMediaEligibility', () => {
  it('presents the design doc allowlist: public domain, CC0, and attributed CC-BY', () => {
    expect(decidePlantMediaEligibility('public_domain', null)).toEqual({ presentable: true });
    expect(decidePlantMediaEligibility('cc0', null)).toEqual({ presentable: true });
    expect(decidePlantMediaEligibility('cc_by', 'A. Botanist')).toEqual({ presentable: true });
  });

  it('refuses non-commercial media, the case GBIF actually mixes into one response', () => {
    expect(decidePlantMediaEligibility('cc_by_nc', 'A. Botanist')).toEqual({
      presentable: false,
      reason: 'non_commercial',
    });
  });

  it('holds ShareAlike pending a compliance design rather than refusing it outright', () => {
    // The only reason here that a decision could legitimately reverse: the
    // pipeline generates derivatives, and SA obligations can propagate to
    // adapted material.
    expect(decidePlantMediaEligibility('cc_by_sa', 'A. Botanist')).toEqual({
      presentable: false,
      reason: 'share_alike_pending_compliance_design',
    });
  });

  it('refuses unknown and withdrawn media, and says which', () => {
    expect(decidePlantMediaEligibility('unknown', 'A. Botanist')).toEqual({
      presentable: false,
      reason: 'licence_unknown',
    });
    expect(decidePlantMediaEligibility('withdrawn', 'A. Botanist')).toEqual({
      presentable: false,
      reason: 'withdrawn',
    });
  });

  it('refuses CC-BY that cannot be attributed, because attribution is the licence condition', () => {
    for (const rightsHolder of [null, '   ']) {
      expect(decidePlantMediaEligibility('cc_by', rightsHolder)).toEqual({
        presentable: false,
        reason: 'rights_holder_absent',
      });
    }
  });

  it('does not require a rights holder for licences that impose no attribution condition', () => {
    expect(decidePlantMediaEligibility('cc0', null)).toEqual({ presentable: true });
    expect(decidePlantMediaEligibility('public_domain', null)).toEqual({ presentable: true });
  });
});

describe('parseProviderLicence', () => {
  it('reads the GBIF URL forms', () => {
    expect(parseProviderLicence('http://creativecommons.org/publicdomain/zero/1.0/')).toBe('cc0');
    expect(parseProviderLicence('http://creativecommons.org/licenses/by/4.0/')).toBe('cc_by');
    expect(parseProviderLicence('http://creativecommons.org/licenses/by-nc/4.0/')).toBe('cc_by_nc');
  });

  it('reads a ShareAlike-plus-NonCommercial licence as non-commercial', () => {
    // `by-nc-sa` carries both conditions; the stricter one decides, and
    // reading it as ShareAlike would file a refusal under a reason that is
    // expected to reverse.
    expect(parseProviderLicence('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(
      'cc_by_nc',
    );
  });

  it('reads the same licence written several ways', () => {
    for (const spelling of [
      'HTTPS://creativecommons.org/publicdomain/zero/1.0',
      'http://creativecommons.org/publicdomain/zero/1.0/',
      '  cc0-1.0  ',
    ]) {
      expect(parseProviderLicence(spelling)).toBe('cc0');
    }
  });

  it('records an unreadable or missing licence as unknown rather than dropping the asset', () => {
    // Stored honestly and then found ineligible, so "how many assets did we
    // refuse, and why" stays answerable.
    for (const absent of [null, undefined, '', '   ', 'http://example.org/bespoke-terms']) {
      expect(parseProviderLicence(absent)).toBe('unknown');
    }
  });
});
