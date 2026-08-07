import type {
  AcceptSeasonalFactResult,
  GardenSeasonalAcceptanceQueue,
} from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface SeasonalAcceptanceGateway {
  listAwaitingAcceptance(
    gardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenSeasonalAcceptanceQueue>>;
  accept(
    gardenId: string,
    factId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<AcceptSeasonalFactResult>>;
}

/**
 * Gateway for the per-garden seasonal-timing acceptance queue.
 *
 * `accept` sends no `Idempotency-Key` and no `If-Match`: the server's unique
 * `(garden_id, taxonomy_seasonal_fact_id)` key already makes a repeat one
 * decision recorded once, and there is no aggregate revision to guard. The
 * CSRF header is still sent, matching every other mutating gateway call.
 *
 * There is no reject: a fact this garden has not accepted is already
 * unreadable by the rules, so declining is simply not accepting.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `SeasonalAcceptance`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createSeasonalAcceptanceGateway(client: ApiClient): SeasonalAcceptanceGateway {
  return {
    listAwaitingAcceptance(gardenId, signal) {
      return client.request<GardenSeasonalAcceptanceQueue>({
        method: 'GET',
        path: `/gardens/${gardenId}/seasonal-facts/awaiting-acceptance`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    accept(gardenId, factId, signal) {
      return client.request<AcceptSeasonalFactResult>({
        method: 'POST',
        path: `/gardens/${gardenId}/seasonal-facts/${factId}/accept`,
        headers: { ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
