/**
 * Tests for the licence rule that decides which provider images may be
 * stored and shown.
 *
 * These are written as licence questions rather than string-parsing
 * questions: the cost of getting one wrong is a licence breach, not a failed
 * request.
 */

import { describe, expect, it } from 'vitest';
import { decideMediaLicence } from './plant-media-licence.js';

describe('decideMediaLicence', () => {
  it('accepts CC0 without needing a rights holder', () => {
    // CC0 waives the attribution condition, so a missing rights holder is
    // not a licence problem.
    expect(decideMediaLicence('http://creativecommons.org/publicdomain/zero/1.0/', null)).toEqual({
      ingestible: true,
      licence: 'cc0',
    });
  });

  it('accepts CC-BY when the rights holder is known', () => {
    expect(
      decideMediaLicence('http://creativecommons.org/licenses/by/4.0/', 'A. Botanist'),
    ).toEqual({ ingestible: true, licence: 'cc_by' });
  });

  it('refuses CC-BY with no rights holder, because it could not be attributed', () => {
    // Ingesting an image this product cannot legally credit is a licence
    // breach wearing a missing field as a disguise.
    expect(decideMediaLicence('https://creativecommons.org/licenses/by/4.0/', '  ')).toEqual({
      ingestible: false,
      refusal: 'rights_holder_absent',
    });
  });

  it('refuses every non-commercial licence, attribution or not', () => {
    // The reason this rule exists: GBIF mixes CC-BY-NC into the same result
    // set as CC0 and CC-BY, and this product is not non-commercial.
    for (const licence of [
      'http://creativecommons.org/licenses/by-nc/4.0/',
      'https://creativecommons.org/licenses/by-nc-sa/4.0/',
      'CC-BY-NC-4.0',
    ]) {
      expect(decideMediaLicence(licence, 'A. Botanist')).toEqual({
        ingestible: false,
        refusal: 'non_commercial',
      });
    }
  });

  it('refuses a licence it does not recognise rather than assuming it is permissive', () => {
    // An unassessed licence is not a permissive one.
    expect(decideMediaLicence('http://example.org/some-bespoke-terms', 'A. Botanist')).toEqual({
      ingestible: false,
      refusal: 'licence_unrecognised',
    });
  });

  it('refuses a missing or blank licence, and reports that separately', () => {
    // "The provider stopped sending licences" and "every record was
    // non-commercial" need different operational responses.
    for (const absent of [null, undefined, '', '   ']) {
      expect(decideMediaLicence(absent, 'A. Botanist')).toEqual({
        ingestible: false,
        refusal: 'licence_absent',
      });
    }
  });

  it('reads the same licence written several ways', () => {
    // Providers vary protocol, trailing slash, case, and version suffix for
    // what is one licence.
    for (const spelling of [
      'HTTPS://creativecommons.org/publicdomain/zero/1.0',
      'http://creativecommons.org/publicdomain/zero/1.0/',
      '  cc0-1.0  ',
    ]) {
      expect(decideMediaLicence(spelling, null)).toEqual({ ingestible: true, licence: 'cc0' });
    }
  });
});
