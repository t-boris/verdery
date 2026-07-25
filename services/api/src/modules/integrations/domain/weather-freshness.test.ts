import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  classifyWeatherFreshness,
  validateWeatherFreshnessPolicy,
  type WeatherFreshnessPolicy,
} from './weather-freshness.js';

const POLICY: WeatherFreshnessPolicy = {
  observationFreshForMs: 60 * 60 * 1000,
  forecastFreshForMs: 6 * 60 * 60 * 1000,
};

const FETCHED_AT = new Date('2026-07-25T12:00:00Z');

function at(offsetMs: number): Date {
  return new Date(FETCHED_AT.getTime() + offsetMs);
}

describe('classifyWeatherFreshness', () => {
  it('classifies fresh strictly within the window and exactly at its boundary', () => {
    const record = { kind: 'observation' as const, fetchedAt: FETCHED_AT };
    expect(classifyWeatherFreshness(record, at(0), POLICY)).toBe('fresh');
    expect(classifyWeatherFreshness(record, at(POLICY.observationFreshForMs), POLICY)).toBe(
      'fresh',
    );
    expect(classifyWeatherFreshness(record, at(POLICY.observationFreshForMs + 1), POLICY)).toBe(
      'stale',
    );
  });

  it('applies the forecast window to forecast records', () => {
    const record = { kind: 'forecast' as const, fetchedAt: FETCHED_AT };
    // Past the observation window but inside the forecast window: still fresh.
    expect(classifyWeatherFreshness(record, at(POLICY.observationFreshForMs + 1), POLICY)).toBe(
      'fresh',
    );
    expect(classifyWeatherFreshness(record, at(POLICY.forecastFreshForMs + 1), POLICY)).toBe(
      'stale',
    );
  });

  it('treats a future fetchedAt (clock skew) as fresh', () => {
    const record = { kind: 'observation' as const, fetchedAt: at(60_000) };
    expect(classifyWeatherFreshness(record, FETCHED_AT, POLICY)).toBe('fresh');
  });
});

describe('validateWeatherFreshnessPolicy', () => {
  it('accepts positive integer windows and rejects zero, negative, and fractional ones', () => {
    expect(validateWeatherFreshnessPolicy(POLICY)).toBe(POLICY);
    expect(() =>
      validateWeatherFreshnessPolicy({ observationFreshForMs: 0, forecastFreshForMs: 1 }),
    ).toThrow(ValidationError);
    expect(() =>
      validateWeatherFreshnessPolicy({ observationFreshForMs: 1, forecastFreshForMs: -5 }),
    ).toThrow(ValidationError);
    expect(() =>
      validateWeatherFreshnessPolicy({ observationFreshForMs: 1.5, forecastFreshForMs: 1 }),
    ).toThrow(ValidationError);
  });
});
