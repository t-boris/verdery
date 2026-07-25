/**
 * Reads the latest stored weather for a garden with an explicit freshness
 * classification — the surface P7-RULE-01's rule engine will consume as its
 * "Weather observations and forecast freshness" input
 * (recommendations-and-ai.md section 4), and the reason "weather staleness"
 * can be a tested degradation (section 18) rather than a silent one.
 *
 * Read-only, no provider call ever: refreshing is exclusively
 * `RefreshGardenWeather`'s job. Absence is a typed `noRecord` outcome —
 * with zero providers configured (today's reality) every garden reads
 * `noRecord`, and the engine's documented degradation is to skip
 * weather-dependent rules, never to invent a value ("Missing facts remain
 * missing", section 4).
 *
 * No authorization here, deliberately: no user-facing transport exposes
 * weather this phase (no `Weather` tag exists in the OpenAPI contract) —
 * the rule engine runs server-side over gardens it is already authorized to
 * process. The stage that first exposes weather to an actor adds
 * authorization with its surface.
 *
 * Source: architecture/external-integrations.md, section "5. Weather"
 * ("Recommendations check freshness and degrade when data is stale");
 * architecture/recommendations-and-ai.md, sections "4. Structured Inputs"
 * and "18. Testing".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { WeatherFreshness, WeatherFreshnessPolicy } from '../domain/weather-freshness.js';
import {
  classifyWeatherFreshness,
  validateWeatherFreshnessPolicy,
} from '../domain/weather-freshness.js';
import type { WeatherRecord, WeatherRecordKind } from '../domain/weather-record.js';
import type { WeatherRecordRepository } from './weather-record-repository.js';

export interface GetGardenWeatherInput {
  readonly gardenId: Uuid;
  /** Defaults to `'observation'` — the current-conditions read. */
  readonly kind?: WeatherRecordKind;
}

export type GetGardenWeatherResult =
  | {
      readonly outcome: 'available';
      readonly record: WeatherRecord;
      readonly freshness: WeatherFreshness;
    }
  | { readonly outcome: 'noRecord' };

export class GetGardenWeather {
  private readonly freshnessPolicy: WeatherFreshnessPolicy;

  constructor(
    private readonly weatherRecords: WeatherRecordRepository,
    freshnessPolicy: WeatherFreshnessPolicy,
    private readonly clock: Clock,
  ) {
    this.freshnessPolicy = validateWeatherFreshnessPolicy(freshnessPolicy);
  }

  async execute(input: GetGardenWeatherInput): Promise<GetGardenWeatherResult> {
    const record = await this.weatherRecords.findLatest(
      input.gardenId,
      input.kind ?? 'observation',
    );
    if (record === null) {
      return { outcome: 'noRecord' };
    }
    return {
      outcome: 'available',
      record,
      freshness: classifyWeatherFreshness(record, this.clock.now(), this.freshnessPolicy),
    };
  }
}
