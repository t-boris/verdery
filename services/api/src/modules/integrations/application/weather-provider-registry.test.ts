import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import {
  FakeWeatherProviderAdapter,
  testProviderMetadata,
  testReading,
} from './integrations-test-doubles.js';
import { WeatherProviderRegistry } from './weather-provider-registry.js';

function registration(providerKey: string) {
  return {
    metadata: testProviderMetadata(providerKey),
    adapter: new FakeWeatherProviderAdapter({ kind: 'succeed', readings: [testReading()] }),
  };
}

describe('WeatherProviderRegistry', () => {
  it('resolves registrations by key and lists registered keys', () => {
    const a = registration('fake-provider-a');
    const b = registration('fake-provider-b');
    const registry = new WeatherProviderRegistry([a, b]);

    expect(registry.get('fake-provider-a')).toBe(a);
    expect(registry.get('fake-provider-b')).toBe(b);
    expect(registry.get('never-registered')).toBeNull();
    expect(registry.keys()).toEqual(['fake-provider-a', 'fake-provider-b']);
  });

  it('is honestly empty today: zero registrations is a valid registry', () => {
    const registry = new WeatherProviderRegistry([]);
    expect(registry.keys()).toEqual([]);
    expect(registry.get('anything')).toBeNull();
  });

  it('rejects duplicate keys at construction', () => {
    expect(
      () =>
        new WeatherProviderRegistry([
          registration('fake-provider-a'),
          registration('fake-provider-a'),
        ]),
    ).toThrow(InternalError);
  });

  it('rejects invalid metadata at construction: blank key, blank license, bad timeout, bad quota limit', () => {
    const adapter = new FakeWeatherProviderAdapter({ kind: 'succeed', readings: [] });
    expect(
      () => new WeatherProviderRegistry([{ metadata: testProviderMetadata('  '), adapter }]),
    ).toThrow(InternalError);
    expect(
      () =>
        new WeatherProviderRegistry([
          { metadata: testProviderMetadata('p', { licenseNote: ' ' }), adapter },
        ]),
    ).toThrow(InternalError);
    expect(
      () =>
        new WeatherProviderRegistry([
          { metadata: testProviderMetadata('p', { fetchTimeoutMs: 0 }), adapter },
        ]),
    ).toThrow(InternalError);
    expect(
      () =>
        new WeatherProviderRegistry([
          {
            metadata: testProviderMetadata('p', {
              quotaLimits: { maxCallsPerHour: -1, maxCallsPerDay: null },
            }),
            adapter,
          },
        ]),
    ).toThrow(InternalError);
  });
});
