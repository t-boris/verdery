import type { GardenWeatherResult } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import type { ApiResult } from './result';

export interface WeatherGateway {
  getGardenWeather(gardenId: string, signal?: AbortSignal): Promise<ApiResult<GardenWeatherResult>>;
}

/**
 * Gateway for the garden weather read.
 *
 * One operation, no commands: refreshing is the scheduled server-side
 * sweep's job exclusively, so there is nothing here a client could call to
 * spend provider quota. A reload re-reads stored records and nothing more.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Weather`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createWeatherGateway(client: ApiClient): WeatherGateway {
  return {
    getGardenWeather(gardenId, signal) {
      return client.request<GardenWeatherResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/weather`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
