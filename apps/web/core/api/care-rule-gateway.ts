import type { GardenCareRulesResult } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

export interface CareRuleGateway {
  getGardenCareRules(
    gardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenCareRulesResult>>;
}

/**
 * Gateway for the care-rules disclosure.
 *
 * One read, no commands: rules are versioned application content, not
 * runtime configuration, so there is nothing here a client could change.
 * Adding or editing a rule is a reviewed code change.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `CareRules`.
 */
export function createCareRuleGateway(client: ApiClient): CareRuleGateway {
  return {
    getGardenCareRules(gardenId, signal) {
      return client.request<GardenCareRulesResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/care-rules`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
