import type { AddressCandidateListResult } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

export interface GeocodingGateway {
  /**
   * Candidate positions for a free-form address.
   *
   * `providerAvailable: false` in the result means the geocoder could not be
   * asked — which the interface must not show as "no such address".
   */
  findAddressCandidates(
    query: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<AddressCandidateListResult>>;
}

/**
 * Gateway for address lookup (P12-GEO-01).
 *
 * The browser talks to this application, never to the geocoder: provider
 * isolation is an architecture rule, and a direct call would also mean
 * widening this application's CSP to a third-party host on every page.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `findAddressCandidates`; architecture/README.md, "Replaceable External
 * Providers".
 */
export function createGeocodingGateway(client: ApiClient): GeocodingGateway {
  return {
    findAddressCandidates(query, signal) {
      const search = new URLSearchParams({ query });

      return client.request<AddressCandidateListResult>({
        method: 'GET',
        path: `/geocoding/address-candidates?${search.toString()}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
