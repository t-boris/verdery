/**
 * `RunWeatherRefreshSweep` (P7-ASYNC-01): one bounded pass over the gardens
 * that can be refreshed, calling `RefreshGardenWeather` per garden — the
 * scheduled caller that use case was built for (its own header comment names
 * this stage as its intended caller).
 *
 * WHERE THIS RUNS, AND WHY: in `services/api`, triggered by an authenticated
 * internal endpoint the worker's own interval scheduler calls — the exact
 * P6-RET-01 retention-sweep shape, for the exact same privilege reasoning
 * (`run-media-retention-sweep.ts`'s own header): `verdery_worker` has no
 * access to `integrations.*` or `gardens_mapping.*` (asserted by the
 * P7-INT-01 negative privilege test), and widening that grant so the worker
 * could iterate gardens itself would trade a held boundary for one query.
 * The worker contributes only its interval loop and its verified OIDC
 * identity.
 *
 * Cost discipline, per garden and per run:
 *
 * - The batch cap bounds one run's consideration; least-recently-fetched
 *   ordering (see `weather-refresh-candidate-source.ts`) rotates fairly.
 * - A garden refreshed recently is a `freshCacheHit` — one read, no provider
 *   call — so overlapping or duplicated runs cannot double-spend quota: the
 *   cache window IS the sweep-level idempotency boundary.
 * - A typed `quotaExhausted` outcome stops the batch honestly: every later
 *   candidate would consume-and-refuse against the same exhausted budget, so
 *   the sweep records the stop instead of grinding through refusals. The
 *   next run retries — quota windows roll over on their own.
 * - With zero providers configured (today's reality — P0-PROV-01), every
 *   garden degrades to the typed `noProviderConfigured` outcome: the sweep
 *   still runs, still returns its structured summary (the worker logs it as
 *   the liveness heartbeat), and writes nothing. A documented, observable
 *   no-op — never a crash, never a silent skip.
 *
 * No per-garden transaction wrapper here, deliberately: `RefreshGardenWeather`
 * already owns its own atomicity (quota consumption is a single guarded
 * transaction; `insertMany` lands one fetch's records whole), and its
 * provider call must stay OUTSIDE any database transaction
 * (backend-modular-monolith.md section 12) — wrapping it would violate that.
 * Each garden is independent; a typed degradation on one never stops the
 * rest (only quota exhaustion does, see above).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  RefreshGardenWeatherResult,
  WeatherUnavailableReason,
} from './refresh-garden-weather.js';
import type { WeatherRefreshCandidateSource } from './weather-refresh-candidate-source.js';

/**
 * Per-run candidate ceiling. No document names a number; 25 bounds one
 * run's provider spend and duration while the hourly cadence and the
 * least-recently-fetched rotation cover any realistic garden count within a
 * day — the same "no number decided yet, pick one and say so" posture
 * `RETENTION_SWEEP_BATCH_LIMIT` documents.
 */
export const WEATHER_REFRESH_SWEEP_BATCH_LIMIT = 25;

/** The narrow slice of `RefreshGardenWeather` this sweep drives — structural, so tests fake it without the full constructor. */
export interface GardenWeatherRefresher {
  execute(input: { readonly gardenId: Uuid }): Promise<RefreshGardenWeatherResult>;
}

export interface WeatherRefreshSweepResult {
  /** Gardens this run actually called `RefreshGardenWeather` for. */
  readonly gardensConsidered: number;
  /** Provider fetches that produced and persisted new records. */
  readonly refreshed: number;
  /** Gardens served from storage inside the freshness window — no provider call. */
  readonly freshCacheHits: number;
  /** Gardens degraded to a labeled stale record (`staleServed`). */
  readonly staleServed: number;
  /** Gardens degraded with nothing stored to serve (`unavailable`). */
  readonly unavailable: number;
  /** Degradation reasons across `staleServed` + `unavailable`, by typed reason — what makes the no-provider no-op legible in one log line. */
  readonly degradationReasons: Readonly<Partial<Record<WeatherUnavailableReason, number>>>;
  /** True when a typed `quotaExhausted` outcome stopped the batch before every candidate was considered. */
  readonly stoppedOnQuotaExhaustion: boolean;
}

export class RunWeatherRefreshSweep {
  constructor(
    private readonly candidates: WeatherRefreshCandidateSource,
    private readonly refreshGardenWeather: GardenWeatherRefresher,
  ) {}

  async execute(): Promise<WeatherRefreshSweepResult> {
    const gardenIds = await this.candidates.listRefreshCandidates(
      WEATHER_REFRESH_SWEEP_BATCH_LIMIT,
    );

    let gardensConsidered = 0;
    let refreshed = 0;
    let freshCacheHits = 0;
    let staleServed = 0;
    let unavailable = 0;
    const degradationReasons: Partial<Record<WeatherUnavailableReason, number>> = {};
    let stoppedOnQuotaExhaustion = false;

    for (const gardenId of gardenIds) {
      const result = await this.refreshGardenWeather.execute({ gardenId });
      gardensConsidered += 1;

      switch (result.outcome) {
        case 'refreshed':
          refreshed += 1;
          break;
        case 'freshCacheHit':
          freshCacheHits += 1;
          break;
        case 'staleServed':
          staleServed += 1;
          degradationReasons[result.reason] = (degradationReasons[result.reason] ?? 0) + 1;
          break;
        case 'unavailable':
          unavailable += 1;
          degradationReasons[result.reason] = (degradationReasons[result.reason] ?? 0) + 1;
          break;
      }

      if (
        (result.outcome === 'staleServed' || result.outcome === 'unavailable') &&
        result.reason === 'quotaExhausted'
      ) {
        stoppedOnQuotaExhaustion = true;
        break;
      }
    }

    return {
      gardensConsidered,
      refreshed,
      freshCacheHits,
      staleServed,
      unavailable,
      degradationReasons,
      stoppedOnQuotaExhaustion,
    };
  }
}
