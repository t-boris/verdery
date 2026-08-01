/**
 * World Flora Online-backed `PlantAssertionProviderAdapter` — the second
 * real adapter for the structured fact/distribution port, and ADR-0016's
 * "taxonomy spine" source: resolving an application taxon's accepted name
 * and provider identity, not facts or distribution/status claims (see
 * `world-flora-online-payload.ts`'s own header for why `fetchFacts` and
 * `fetchDistribution` both answer an honest empty array rather than parsing
 * WFO's undocumented GraphQL endpoint).
 *
 * NO API KEY, NO DOCUMENTED RATE LIMIT: `docs/development/plant-knowledge-
 * provider-runbooks.md` section 2.1 found none of either for
 * `matching_rest.php` — the same defensive-timeout posture
 * `usda-plants-adapter.ts` takes for its own undocumented host.
 *
 * HTTP: `globalThis.fetch`, GET-only — the same narrow `WorldFloraOnlineHttpFetch`
 * slice shape `open-meteo-weather-adapter.ts`'s own header documents for a
 * GET-only provider. `globalThis.fetch` is assignable as-is.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "11. Reliability"; docs/development/plant-knowledge-provider-
 * runbooks.md, section 2.1.
 */

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  NormalizedDistributionCandidate,
  NormalizedFactCandidate,
  PlantAssertionProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from '../application/plant-assertion-provider.js';
import { parseWorldFloraOnlineMatchPayload } from './world-flora-online-payload.js';

export const WORLD_FLORA_ONLINE_BASE_URL = 'https://list.worldfloraonline.org';
const MATCHING_PATH = '/matching_rest.php';

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface WorldFloraOnlineHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls — GET only. `globalThis.fetch` is assignable as-is. */
export type WorldFloraOnlineHttpFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<WorldFloraOnlineHttpResponse>;

export class WorldFloraOnlineAdapter implements PlantAssertionProviderAdapter {
  constructor(private readonly httpFetch: WorldFloraOnlineHttpFetch) {}

  async searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]> {
    const url = new URL(MATCHING_PATH, WORLD_FLORA_ONLINE_BASE_URL);
    url.searchParams.set('input_string', query.scientificName);

    let response: WorldFloraOnlineHttpResponse;
    try {
      response = await this.httpFetch(url.toString(), { signal });
    } catch (error) {
      throw new DependencyUnavailableError(
        'integrations.world_flora_online.request_failed',
        'The World Flora Online request did not complete.',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new DependencyUnavailableError(
        'integrations.world_flora_online.http_status',
        `World Flora Online answered with HTTP status ${String(response.status)}.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new DependencyUnavailableError(
        'integrations.world_flora_online.unreadable_body',
        'The World Flora Online response body was not readable JSON.',
        { cause: error },
      );
    }
    return parseWorldFloraOnlineMatchPayload(body);
  }

  /** Always empty — see this file's own header and `world-flora-online-payload.ts`'s. */
  fetchFacts(
    _providerTaxonId: string,
    _signal: AbortSignal,
  ): Promise<readonly NormalizedFactCandidate[]> {
    return Promise.resolve([]);
  }

  /** Always empty — WFO carries no distribution/status data at all, only taxonomic identity. */
  fetchDistribution(
    _providerTaxonId: string,
    _signal: AbortSignal,
  ): Promise<readonly NormalizedDistributionCandidate[]> {
    return Promise.resolve([]);
  }
}
