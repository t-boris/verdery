import { ValidationError } from '../../../platform/errors/application-error.js';
import type {
  AddressGeocodingAdapter,
  GeocodedAddressCandidate,
} from './address-geocoding-provider.js';
import { withDeadline } from './with-deadline.js';

/** Shortest query worth sending. Below this a search matches half a state and helps nobody. */
const MINIMUM_QUERY_LENGTH = 3;

/** Longest query accepted. An address is not a paragraph, and the provider is not a search engine. */
const MAXIMUM_QUERY_LENGTH = 200;

/**
 * A strict deadline, per external-integrations.md section 11. Someone is
 * waiting behind this call with a text field open; a geocoder that takes
 * longer than this has effectively not answered.
 */
const DEADLINE_MS = 5_000;

export type FindAddressCandidatesResult =
  | { readonly kind: 'candidates'; readonly candidates: readonly GeocodedAddressCandidate[] }
  /** The provider failed or ran out of time. Distinct from "no matches", which is `candidates: []`. */
  | { readonly kind: 'unavailable' };

/**
 * Looks up candidate positions for a free-form address (P12-GEO-01's address
 * search).
 *
 * Reads nothing and writes nothing: the result is shown to a person who then
 * decides whether to move their garden's anchor. That is the whole reason
 * this can use a provider whose data may not be stored — nothing here stores
 * it.
 *
 * A provider failure becomes `unavailable` rather than an error response.
 * Every other way of finding a location — the browser's own positioning,
 * typing coordinates, a pin on the map — still works when the geocoder does
 * not, so a failure here degrades one input rather than the screen.
 */
export class FindAddressCandidates {
  constructor(private readonly geocoder: AddressGeocodingAdapter) {}

  async execute(rawQuery: string): Promise<FindAddressCandidatesResult> {
    const query = rawQuery.trim();

    if (query.length < MINIMUM_QUERY_LENGTH || query.length > MAXIMUM_QUERY_LENGTH) {
      throw new ValidationError(
        'request.invalid',
        `query must be between ${String(MINIMUM_QUERY_LENGTH)} and ${String(MAXIMUM_QUERY_LENGTH)} characters.`,
        { details: [{ code: 'request.invalid', parameters: { pointer: '/query' } }] },
      );
    }

    const outcome = await withDeadline(DEADLINE_MS, async (signal) => {
      try {
        return await this.geocoder.findAddressCandidates(query, signal);
      } catch {
        // The adapter's own typed failure carries a provider name and a
        // status; neither belongs in an answer to someone typing an address.
        return null;
      }
    });

    if (outcome.kind === 'timedOut' || outcome.value === null) {
      return { kind: 'unavailable' };
    }

    return { kind: 'candidates', candidates: outcome.value };
  }
}
