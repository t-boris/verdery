/**
 * Nominatim's own payload, parsed at the adapter boundary so no vendor shape
 * reaches the application.
 *
 * The service answers `GET /search?format=jsonv2` with an ARRAY of places:
 * `[{ display_name, lat, lon, addresstype, category, type, ... }]`. Two
 * things about that shape are worth stating once, here, with tests on them:
 *
 * - `lat` and `lon` are STRINGS, not numbers, and they are decimal degrees.
 *   Parsing them where the port expects `[longitude, latitude]` also swaps
 *   them into the geometry package's order, which is the same trap the Census
 *   adapter's `x`/`y` documents.
 * - There is no confidence field. `addresstype` says what KIND of thing was
 *   matched, which is what the port's coarse `AddressPrecision` actually
 *   wants: a specific building, a street, or an area.
 *
 * Source: https://nominatim.org/release-docs/latest/api/Search/ (read
 * 2026-08-08).
 */

import type {
  AddressPrecision,
  GeocodedAddressCandidate,
} from '../application/address-geocoding-provider.js';

interface NominatimPlace {
  readonly display_name?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly addresstype?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The address types Nominatim uses for something a person can stand on.
 *
 * `building` and `house` are the two that mean "this roof"; a `place` result
 * with a house number is the same thing under another name, but this reads
 * the type rather than guessing from the name, because a name is prose.
 */
const BUILDING_TYPES = new Set(['building', 'house', 'residential', 'address', 'amenity']);
const STREET_TYPES = new Set(['road', 'street', 'footway', 'path', 'pedestrian']);

function precisionOf(place: NominatimPlace): AddressPrecision {
  const type = typeof place.addresstype === 'string' ? place.addresstype : '';

  if (BUILDING_TYPES.has(type)) {
    return 'streetAddress';
  }
  if (STREET_TYPES.has(type)) {
    return 'street';
  }
  return 'area';
}

/**
 * A coordinate string, as a finite number, or `null`.
 *
 * `Number('')` is `0`, which would put a garden in the Gulf of Guinea rather
 * than reject the row — so the emptiness is checked before the conversion.
 */
function coordinate(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns one Nominatim response into port candidates.
 *
 * Returns `null` only when the body is not the array the service documents —
 * the adapter turns that into a typed degradation. An array with unusable
 * rows in it is not a failure: the usable ones are returned and the rest
 * dropped, because a person searching for their house is better served by
 * three candidates than by an error about a fourth.
 */
export function parseNominatimGeocodingPayload(
  body: unknown,
): readonly GeocodedAddressCandidate[] | null {
  if (!Array.isArray(body)) {
    return null;
  }

  const candidates: GeocodedAddressCandidate[] = [];

  for (const entry of body) {
    if (!isRecord(entry)) {
      continue;
    }

    const place = entry as NominatimPlace;
    const longitude = coordinate(place.lon);
    const latitude = coordinate(place.lat);
    const formattedAddress = typeof place.display_name === 'string' ? place.display_name : '';

    if (longitude === null || latitude === null || formattedAddress.trim() === '') {
      continue;
    }

    candidates.push({
      formattedAddress,
      position: [longitude, latitude],
      precision: precisionOf(place),
    });
  }

  return candidates;
}
