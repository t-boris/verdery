/**
 * Elapsed rainfall for one garden over a recent window — the accumulation
 * read the rule engine's watering decision is built on.
 *
 * WHY THIS EXISTS SEPARATELY FROM `GetGardenWeather`: that use case answers
 * "what is the latest reading", which is one provider-defined period — for
 * Open-Meteo's `current` block, the preceding hour. An hour without rain
 * says nothing about a week of drought, and an hour of rain says nothing
 * about whether the soil is wet. Deciding whether a plant needs water is a
 * question about accumulation, and accumulation is a different read.
 *
 * Read-only and provider-free, exactly like its sibling: refreshing stays
 * `RefreshGardenWeather`'s job on the scheduled sweep, so nothing here can
 * spend quota or fail because a provider is down.
 *
 * RETURNS RAW PERIOD TOTALS, DELIBERATELY. Every judgement about what the
 * numbers MEAN — how much rain counts as meaningful, what total is a
 * deficit, how many days of history a decision needs — belongs to the
 * versioned rules that are horticulturally reviewed, not to an integration
 * read that is not. This module supplies measurements; the rule module
 * supplies thresholds.
 *
 * No authorization: the same server-side posture `GetGardenWeather` and
 * `RefreshGardenWeather` document, for the same reason — the rule engine
 * runs over gardens it is already authorized to process. A client-facing
 * caller adds authorization with its own surface, as
 * `GetGardenWeatherView` did.
 *
 * Source: architecture/external-integrations.md, section "5. Weather";
 * architecture/recommendations-and-ai.md, section "4. Structured Inputs".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PrecipitationEntry, WeatherRecordRepository } from './weather-record-repository.js';

export interface GetGardenPrecipitationInput {
  readonly gardenId: Uuid;
  /** Only periods effective at or after this moment are summed. */
  readonly since: Date;
  /**
   * Which accumulation class to read. The caller states it because only the
   * caller knows which series it intends to sum; adding two classes together
   * double counts the shorter inside the longer.
   */
  readonly intervalSeconds: number;
}

export class GetGardenPrecipitation {
  constructor(private readonly weatherRecords: WeatherRecordRepository) {}

  /** Oldest first. Empty when the garden has no elapsed totals of this class — which a caller must read as "unknown", never as "no rain fell". */
  execute(input: GetGardenPrecipitationInput): Promise<readonly PrecipitationEntry[]> {
    return this.weatherRecords.listElapsedPrecipitation(
      input.gardenId,
      input.intervalSeconds,
      input.since,
    );
  }
}
