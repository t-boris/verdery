import type {
  GardenContextFact,
  GardenContextFactListResult,
  GardenContextKind,
  RecordGardenContextFactRequest,
} from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface GardenContextGateway {
  list(gardenId: string, signal?: AbortSignal): Promise<ApiResult<GardenContextFactListResult>>;
  record(
    gardenId: string,
    contextKind: GardenContextKind,
    input: RecordGardenContextFactRequest,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenContextFact>>;
}

/**
 * Gateway for the garden context facts endpoints (P9D-CONTEXT-01).
 *
 * `record` sends neither `Idempotency-Key` nor `If-Match`: the operation is a
 * last-writer-wins upsert on the natural key `(gardenId, contextKind)`, not a
 * revision-guarded aggregate edit — see
 * `services/api/src/modules/gardens-mapping/application/record-garden-context-fact.ts`'s
 * own header for why this one command deliberately departs from this
 * module's usual revision-guarded pattern. The CSRF header is still sent,
 * matching every other mutating gateway call.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `GardenContext`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createGardenContextGateway(client: ApiClient): GardenContextGateway {
  return {
    list(gardenId, signal) {
      return client.request<GardenContextFactListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/context`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    record(gardenId, contextKind, input, signal) {
      return client.request<GardenContextFact>({
        method: 'PUT',
        path: `/gardens/${gardenId}/context/${contextKind}`,
        body: input,
        headers: { ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
