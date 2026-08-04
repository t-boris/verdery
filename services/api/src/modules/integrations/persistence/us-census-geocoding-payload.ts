/**
 * The United States Census Bureau geocoder's own payload, parsed at the
 * adapter boundary so no vendor shape reaches the application.
 *
 * The service answers `GET /geocoder/locations/onelineaddress` with
 * `{ result: { addressMatches: [ { matchedAddress, coordinates: { x, y },
 * tigerLine, addressComponents } ] } }`. `x` is LONGITUDE and `y` is
 * LATITUDE — the opposite order from how the pair is spoken, which is exactly
 * the kind of mistake this file exists to make once, in one place, with a
 * test on it.
 *
 * Source: https://geocoding.geo.census.gov/geocoder/ (Census Geocoder API
 * documentation, read 2026-08-04).
 */

import type {
  AddressPrecision,
  GeocodedAddressCandidate,
} from '../application/address-geocoding-provider.js';

interface CensusMatch {
  readonly matchedAddress?: unknown;
  readonly coordinates?: { readonly x?: unknown; readonly y?: unknown };
  readonly addressComponents?: { readonly fromAddress?: unknown; readonly streetName?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * What the match's own components say about how precisely it was located.
 *
 * The Census geocoder returns no confidence field. It does say what it
 * matched on, and that is enough for the only distinction a person acting on
 * this needs: a house number on a street segment, a street without one, or
 * neither.
 */
function precisionOf(match: CensusMatch): AddressPrecision {
  const components = match.addressComponents;

  if (typeof components?.fromAddress === 'string' && components.fromAddress.trim() !== '') {
    return 'streetAddress';
  }
  if (typeof components?.streetName === 'string' && components.streetName.trim() !== '') {
    return 'street';
  }
  return 'area';
}

/**
 * Parses a Census geocoder response into normalized candidates.
 *
 * A structurally unusable body throws; a body that is merely EMPTY of matches
 * returns an empty array, because "no such address" is an answer. Individual
 * malformed matches are skipped rather than failing the whole response: one
 * unusable row should not hide four good ones.
 */
export function parseCensusGeocodingPayload(body: unknown): readonly GeocodedAddressCandidate[] {
  if (!isRecord(body) || !isRecord(body['result'])) {
    throw new Error('Census geocoder response has no result object.');
  }

  const matches = body['result']['addressMatches'];

  if (matches === undefined) {
    throw new Error('Census geocoder response has no addressMatches array.');
  }
  if (!Array.isArray(matches)) {
    throw new Error('Census geocoder addressMatches is not an array.');
  }

  const candidates: GeocodedAddressCandidate[] = [];

  for (const entry of matches) {
    if (!isRecord(entry)) {
      continue;
    }

    const match = entry as CensusMatch;
    const longitude = match.coordinates?.x;
    const latitude = match.coordinates?.y;

    if (
      typeof match.matchedAddress !== 'string' ||
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude)
    ) {
      continue;
    }

    candidates.push({
      formattedAddress: match.matchedAddress,
      position: [longitude, latitude],
      precision: precisionOf(match),
    });
  }

  return candidates;
}
