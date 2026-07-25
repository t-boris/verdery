/**
 * Weather freshness: external-integrations.md section 5's "Recommendations
 * check freshness and degrade when data is stale", as a pure read-time
 * classification over a record's retrieval age.
 *
 * Freshness is derived, never stored — a persisted classification would rot
 * as wall-clock time passes. The SAME window drives two behaviors, by
 * design: a record still `fresh` is served from storage instead of
 * refetched (the cache rule — section 3's "Cache and freshness rules" as
 * one policy, not two), and a record past it is `stale`, a typed state its
 * consumer sees and must degrade on, never a silent substitution
 * ("Cached stale data is labeled and used only when product rules permit
 * it", section 11).
 *
 * The THRESHOLD NUMBERS deliberately do not live here: quotas, budgets, and
 * thresholds are undecided implementation-time selections
 * (technical-specification.md section 14.2), so the policy is
 * configuration-injected and validated, with no invented default constant —
 * the same numbers-are-not-mechanism posture
 * `media/domain/quota-reservation.ts` documents for its own missing limits.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "5. Weather", "11. Reliability";
 * architecture/recommendations-and-ai.md, section "18. Testing"
 * ("Weather staleness").
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { WeatherRecord } from './weather-record.js';

export type WeatherFreshness = 'fresh' | 'stale';

/**
 * How long a record of each kind stays fresh after retrieval, in
 * milliseconds. Separate per kind because an observation and a forecast age
 * differently, and section 5 names both effective-time flavors.
 */
export interface WeatherFreshnessPolicy {
  readonly observationFreshForMs: number;
  readonly forecastFreshForMs: number;
}

/** Rejects a non-positive or non-integer window — a policy that keeps nothing fresh (or fresh for fractional milliseconds) is a configuration mistake, not a tuning choice. */
export function validateWeatherFreshnessPolicy(
  policy: WeatherFreshnessPolicy,
): WeatherFreshnessPolicy {
  for (const [field, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        `${field} must be a positive integer of milliseconds.`,
        {
          details: [
            { code: 'integrations.weather_freshness_policy.window.invalid', pointer: `/${field}` },
          ],
        },
      );
    }
  }
  return policy;
}

/**
 * Classifies a record by retrieval age: `fresh` while
 * `now - fetchedAt <= window`, `stale` after. Retrieval time, not effective
 * time, is the basis — what goes stale is this system's knowledge of the
 * provider's data. A `fetchedAt` in the future (clock skew) yields a
 * negative age and classifies `fresh`; skew is not this function's problem
 * to diagnose.
 */
export function classifyWeatherFreshness(
  record: Pick<WeatherRecord, 'kind' | 'fetchedAt'>,
  now: Date,
  policy: WeatherFreshnessPolicy,
): WeatherFreshness {
  const freshForMs =
    record.kind === 'observation' ? policy.observationFreshForMs : policy.forecastFreshForMs;
  const ageMs = now.getTime() - record.fetchedAt.getTime();
  return ageMs <= freshForMs ? 'fresh' : 'stale';
}
