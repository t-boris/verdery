import type { SeasonalPlanResult } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

export interface SeasonalPlanGateway {
  get(gardenId: string, signal?: AbortSignal): Promise<ApiResult<SeasonalPlanResult>>;
}

/**
 * Gateway for the seasonal plan read (P9D-SEASON-API-01): every active
 * plant's reviewed seasonal timing (or its explicit `noSeasonalData`
 * marker) plus the continuous bed-rotation status, garden-wide.
 *
 * A single-operation gateway, matching `createHealthGateway`'s own shape —
 * this resource has exactly one read and no commands.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `SeasonalPlan`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createSeasonalPlanGateway(client: ApiClient): SeasonalPlanGateway {
  return {
    get(gardenId, signal) {
      return client.request<SeasonalPlanResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/seasonal-plan`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
