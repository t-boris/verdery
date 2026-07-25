import { describe, expect, it } from 'vitest';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { RefreshGardenWeatherResult } from './refresh-garden-weather.js';
import type { GardenWeatherRefresher } from './run-weather-refresh-sweep.js';
import {
  RunWeatherRefreshSweep,
  WEATHER_REFRESH_SWEEP_BATCH_LIMIT,
} from './run-weather-refresh-sweep.js';
import type { WeatherRefreshCandidateSource } from './weather-refresh-candidate-source.js';

const GARDEN_A = '018f0000-0000-7000-8000-00000000000a';
const GARDEN_B = '018f0000-0000-7000-8000-00000000000b';
const GARDEN_C = '018f0000-0000-7000-8000-00000000000c';

function candidateSource(ids: readonly Uuid[]): WeatherRefreshCandidateSource & {
  requestedLimits: number[];
} {
  const requestedLimits: number[] = [];
  return {
    requestedLimits,
    listRefreshCandidates(limit: number): Promise<readonly Uuid[]> {
      requestedLimits.push(limit);
      return Promise.resolve(ids);
    },
  };
}

/** Scripts one result per garden id; records call order. */
function refresher(
  results: Readonly<Record<string, RefreshGardenWeatherResult>>,
): GardenWeatherRefresher & { calls: Uuid[] } {
  const calls: Uuid[] = [];
  return {
    calls,
    execute({ gardenId }): Promise<RefreshGardenWeatherResult> {
      calls.push(gardenId);
      const result = results[gardenId];
      if (result === undefined) {
        throw new Error(`No scripted result for garden ${gardenId}`);
      }
      return Promise.resolve(result);
    },
  };
}

const NO_PROVIDER: RefreshGardenWeatherResult = {
  outcome: 'unavailable',
  reason: 'noProviderConfigured',
};

describe('RunWeatherRefreshSweep', () => {
  it('with zero providers configured, sweeps every candidate as a typed no-op and reports the reason', async () => {
    const source = candidateSource([GARDEN_A, GARDEN_B]);
    const refresh = refresher({ [GARDEN_A]: NO_PROVIDER, [GARDEN_B]: NO_PROVIDER });

    const result = await new RunWeatherRefreshSweep(source, refresh).execute();

    expect(source.requestedLimits).toEqual([WEATHER_REFRESH_SWEEP_BATCH_LIMIT]);
    expect(refresh.calls).toEqual([GARDEN_A, GARDEN_B]);
    expect(result).toEqual({
      gardensConsidered: 2,
      refreshed: 0,
      freshCacheHits: 0,
      staleServed: 0,
      unavailable: 2,
      degradationReasons: { noProviderConfigured: 2 },
      stoppedOnQuotaExhaustion: false,
    });
  });

  it('counts each outcome kind separately, in the candidate order the source produced', async () => {
    const source = candidateSource([GARDEN_A, GARDEN_B, GARDEN_C]);
    const record = { id: 'irrelevant' } as unknown as never;
    const refresh = refresher({
      [GARDEN_A]: { outcome: 'refreshed', records: [record] },
      [GARDEN_B]: { outcome: 'freshCacheHit', record },
      [GARDEN_C]: { outcome: 'staleServed', record, reason: 'providerTimeout' },
    });

    const result = await new RunWeatherRefreshSweep(source, refresh).execute();

    expect(result).toEqual({
      gardensConsidered: 3,
      refreshed: 1,
      freshCacheHits: 1,
      staleServed: 1,
      unavailable: 0,
      degradationReasons: { providerTimeout: 1 },
      stoppedOnQuotaExhaustion: false,
    });
  });

  it('stops the batch honestly on a typed quotaExhausted outcome instead of grinding through refusals', async () => {
    const source = candidateSource([GARDEN_A, GARDEN_B, GARDEN_C]);
    const refresh = refresher({
      [GARDEN_A]: { outcome: 'unavailable', reason: 'quotaExhausted' },
      // GARDEN_B / GARDEN_C deliberately unscripted: reaching them fails.
    });

    const result = await new RunWeatherRefreshSweep(source, refresh).execute();

    expect(refresh.calls).toEqual([GARDEN_A]);
    expect(result).toEqual({
      gardensConsidered: 1,
      refreshed: 0,
      freshCacheHits: 0,
      staleServed: 0,
      unavailable: 1,
      degradationReasons: { quotaExhausted: 1 },
      stoppedOnQuotaExhaustion: true,
    });
  });

  it('an empty candidate list completes with an all-zero summary — the heartbeat still emits', async () => {
    const result = await new RunWeatherRefreshSweep(candidateSource([]), refresher({})).execute();

    expect(result).toEqual({
      gardensConsidered: 0,
      refreshed: 0,
      freshCacheHits: 0,
      staleServed: 0,
      unavailable: 0,
      degradationReasons: {},
      stoppedOnQuotaExhaustion: false,
    });
  });
});
