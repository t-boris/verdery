import type { PlantProfileVersion } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

export interface PlantCatalogGateway {
  getTaxonProfile(
    taxonomyReferenceId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantProfileVersion>>;
}

/**
 * Gateway for the plant-catalog endpoints.
 *
 * Its own file rather than another method on `plant-gateway.ts`: the catalog
 * is a shared reference surface with no `gardenId` anywhere in its paths,
 * while every `Plants` operation is garden-scoped. Keeping them apart keeps
 * that difference visible at the call site.
 *
 * A taxon with no assembled profile is an honest `404` from this operation,
 * not an empty profile — see the contract's own wording. Callers therefore
 * distinguish "nothing known yet" from "known to be empty" by the failure,
 * and this gateway does not flatten it into `null`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `PlantCatalog`;
 * architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md, section 3.
 */
export function createPlantCatalogGateway(client: ApiClient): PlantCatalogGateway {
  return {
    getTaxonProfile(taxonomyReferenceId, signal) {
      return client.request<PlantProfileVersion>({
        method: 'GET',
        path: `/plant-catalog/taxa/${taxonomyReferenceId}/profile`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
