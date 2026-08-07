import type { PlantCareView } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

export interface PlantCareGateway {
  getPlantCare(
    gardenId: string,
    plantId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCareView>>;
}

/**
 * Gateway for the per-plant care view.
 *
 * One read, no commands. Acting on what it returns goes through the
 * recommendation and task gateways that already own those verbs — this
 * endpoint assembles, it does not decide, so there is nothing here to
 * write back to.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getPlantCareView`.
 */
export function createPlantCareGateway(client: ApiClient): PlantCareGateway {
  return {
    getPlantCare(gardenId, plantId, signal) {
      return client.request<PlantCareView>({
        method: 'GET',
        path: `/gardens/${gardenId}/plants/${plantId}/care`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
