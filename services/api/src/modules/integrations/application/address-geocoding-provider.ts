/**
 * Provider-neutral address-geocoding port — the same boundary
 * external-integrations.md section 2 draws for weather: "domain/application →
 * provider-neutral port → provider adapter → external API. Provider SDK and
 * payload types remain inside the adapter."
 *
 * This is a LOOKUP, never a write. The owner's 2026-08-04 decision on
 * geocoding is that no provider payload is stored: a candidate is shown, the
 * person picks one, and the accepted coordinate plus formatted display
 * address persist with the georeference. The query, precision vocabulary,
 * and unaccepted candidates remain transient.
 *
 * Source: architecture/external-integrations.md, sections "2. Integration
 * Boundary" and "3. Adapter Contract"; implementation-plan.md §30.1
 * (geocoding provider selection).
 */

import type { Position } from '@verdery/geometry-contracts';

/**
 * How exactly a provider claims to have located an address.
 *
 * Deliberately coarse. A provider's own confidence vocabulary is its own; what
 * a person needs to decide whether to accept a pin is whether it is their
 * roof, their street, or their town.
 */
export type AddressPrecision =
  /** Interpolated to a position along a street segment — a house number's usual accuracy. */
  | 'streetAddress'
  /** A street, without a specific number on it. */
  | 'street'
  /** A postal code, a city, or something else that covers an area. */
  | 'area';

export interface GeocodedAddressCandidate {
  /** The address as the provider matched it, for the person to recognize — never reformatted here. */
  readonly formattedAddress: string;
  /** `[longitude, latitude]`, WGS84. */
  readonly position: Position;
  readonly precision: AddressPrecision;
}

export interface AddressGeocodingAdapter {
  /**
   * Finds candidate positions for a free-form address.
   *
   * An empty array is a real answer — "nothing matched" — and not a failure.
   * May reject with anything; the caller converts every failure into a typed
   * degradation, never a crash, the same posture the weather port documents.
   */
  findAddressCandidates(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly GeocodedAddressCandidate[]>;
}
