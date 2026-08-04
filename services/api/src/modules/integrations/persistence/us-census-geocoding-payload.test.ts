import { describe, expect, it } from 'vitest';

import { parseCensusGeocodingPayload } from './us-census-geocoding-payload.js';

/**
 * Recorded from the live service on 2026-08-04:
 * `GET /geocoder/locations/onelineaddress?address=1600+Pennsylvania+Ave+NW,+Washington,+DC
 * &benchmark=Public_AR_Current&format=json`. Trimmed to the fields this
 * adapter reads.
 */
const RECORDED = {
  result: {
    input: { address: { address: '1600 Pennsylvania Ave NW, Washington, DC' } },
    addressMatches: [
      {
        tigerLine: { side: 'L', tigerLineId: '76225813' },
        coordinates: { x: -77.03518753691, y: 38.89869893252 },
        addressComponents: {
          zip: '20500',
          streetName: 'PENNSYLVANIA',
          city: 'WASHINGTON',
          fromAddress: '1600',
          state: 'DC',
          suffixType: 'AVE',
        },
        matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
      },
    ],
  },
};

describe('parseCensusGeocodingPayload', () => {
  it('reads the recorded response as one street-address candidate', () => {
    expect(parseCensusGeocodingPayload(RECORDED)).toEqual([
      {
        formattedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
        position: [-77.03518753691, 38.89869893252],
        precision: 'streetAddress',
      },
    ]);
  });

  // The provider names them `x` and `y`, in the opposite order from how the
  // pair is spoken. Getting this backwards puts a garden in the Indian Ocean.
  it('reads x as longitude and y as latitude', () => {
    const [candidate] = parseCensusGeocodingPayload(RECORDED);

    expect(candidate?.position[0]).toBeLessThan(0);
    expect(candidate?.position[1]).toBeGreaterThan(0);
  });

  it('calls a match with a street but no house number a street match', () => {
    const body = {
      result: {
        addressMatches: [
          {
            coordinates: { x: -93.63, y: 41.59 },
            addressComponents: { streetName: 'GRAND', fromAddress: '' },
            matchedAddress: 'GRAND AVE, DES MOINES, IA',
          },
        ],
      },
    };

    expect(parseCensusGeocodingPayload(body)[0]?.precision).toBe('street');
  });

  it('calls a match with neither an area match', () => {
    const body = {
      result: {
        addressMatches: [
          {
            coordinates: { x: -93.63, y: 41.59 },
            addressComponents: {},
            matchedAddress: 'DES MOINES, IA, 50309',
          },
        ],
      },
    };

    expect(parseCensusGeocodingPayload(body)[0]?.precision).toBe('area');
  });

  it('treats no matches as an answer, not a failure', () => {
    expect(parseCensusGeocodingPayload({ result: { addressMatches: [] } })).toEqual([]);
  });

  // One unusable row must not hide the good ones beside it.
  it('skips a malformed match and keeps the rest', () => {
    const body = {
      result: {
        addressMatches: [
          { coordinates: { x: 'not a number', y: 41.59 }, matchedAddress: 'BROKEN' },
          { matchedAddress: 'NO COORDINATES' },
          {
            coordinates: { x: -93.63, y: 41.59 },
            addressComponents: { fromAddress: '100' },
            matchedAddress: 'GOOD MATCH',
          },
        ],
      },
    };

    const candidates = parseCensusGeocodingPayload(body);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.formattedAddress).toBe('GOOD MATCH');
  });

  it.each([
    ['a body that is not an object', 'nope'],
    ['a body with no result', {}],
    ['a result with no addressMatches', { result: {} }],
    ['addressMatches that is not an array', { result: { addressMatches: {} } }],
  ])('refuses %s', (_case, body) => {
    expect(() => parseCensusGeocodingPayload(body)).toThrow();
  });
});
