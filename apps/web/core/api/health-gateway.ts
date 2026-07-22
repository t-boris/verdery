import type { LivenessResult, ReadinessResult } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

/** Status the readiness probe reports when a required dependency is unavailable. */
const SERVICE_UNAVAILABLE = 503;

export interface HealthGateway {
  readLiveness(signal?: AbortSignal): Promise<ApiResult<LivenessResult>>;
  readReadiness(signal?: AbortSignal): Promise<ApiResult<ReadinessResult>>;
}

/**
 * Gateway for the operations health endpoints.
 *
 * The contract documents `/health/ready` as returning a `ReadinessResult` for
 * both `200` and `503`. A caller that treated every non-2xx response as a
 * failure would therefore discard exactly the report it asked for, so the
 * gateway declares `503` as a schema-carrying status.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getReadiness`;
 * architecture/api-design.md, section "13. Status Codes".
 */
export function createHealthGateway(client: ApiClient): HealthGateway {
  return {
    readLiveness(signal) {
      return client.request<LivenessResult>({
        method: 'GET',
        path: '/health/live',
        ...(signal === undefined ? {} : { signal }),
      });
    },

    readReadiness(signal) {
      return client.request<ReadinessResult>({
        method: 'GET',
        path: '/health/ready',
        schemaStatuses: [SERVICE_UNAVAILABLE],
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
