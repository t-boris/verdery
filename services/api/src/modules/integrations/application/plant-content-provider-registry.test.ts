import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import {
  FakePlantContentProviderAdapter,
  testPlantContent,
  testPlantContentProviderMetadata,
  testTaxonCandidate,
} from './integrations-test-doubles.js';
import {
  PlantContentProviderRegistry,
  requireRegisteredPlantContentProvider,
} from './plant-content-provider-registry.js';

function registration(providerKey: string) {
  return {
    metadata: testPlantContentProviderMetadata(providerKey),
    adapter: new FakePlantContentProviderAdapter(
      { kind: 'succeed', candidates: [testTaxonCandidate()] },
      { kind: 'succeed', content: testPlantContent() },
    ),
  };
}

describe('PlantContentProviderRegistry', () => {
  it('resolves registrations by key and lists registered keys', () => {
    const a = registration('fake-plant-provider-a');
    const b = registration('fake-plant-provider-b');
    const registry = new PlantContentProviderRegistry([a, b]);

    expect(registry.get('fake-plant-provider-a')).toBe(a);
    expect(registry.get('fake-plant-provider-b')).toBe(b);
    expect(registry.get('never-registered')).toBeNull();
    expect(registry.keys()).toEqual(['fake-plant-provider-a', 'fake-plant-provider-b']);
  });

  it('is honestly empty today: zero registrations is a valid registry', () => {
    const registry = new PlantContentProviderRegistry([]);
    expect(registry.keys()).toEqual([]);
    expect(registry.get('anything')).toBeNull();
  });

  it('rejects duplicate keys at construction', () => {
    expect(
      () =>
        new PlantContentProviderRegistry([
          registration('fake-plant-provider-a'),
          registration('fake-plant-provider-a'),
        ]),
    ).toThrow(InternalError);
  });

  it('rejects invalid metadata at construction: blank key, blank license, blank presentation note, bad timeout, bad quota limit', () => {
    const make = (metadata: ReturnType<typeof testPlantContentProviderMetadata>) => () =>
      new PlantContentProviderRegistry([
        { metadata, adapter: registration('fake-plant-provider-a').adapter },
      ]);

    expect(make(testPlantContentProviderMetadata('  '))).toThrow(InternalError);
    expect(
      make(testPlantContentProviderMetadata('fake-plant-provider-a', { licenseNote: ' ' })),
    ).toThrow(InternalError);
    // Section 8's "allowed presentation behavior" is a registration
    // obligation, not an optional nicety.
    expect(
      make(testPlantContentProviderMetadata('fake-plant-provider-a', { presentationNote: '' })),
    ).toThrow(InternalError);
    expect(
      make(testPlantContentProviderMetadata('fake-plant-provider-a', { fetchTimeoutMs: 0 })),
    ).toThrow(InternalError);
    expect(
      make(
        testPlantContentProviderMetadata('fake-plant-provider-a', {
          quotaLimits: { maxCallsPerHour: 0, maxCallsPerDay: null },
        }),
      ),
    ).toThrow(InternalError);
  });

  it('accepts a null jurisdiction: terms that name none stay honestly unstated', () => {
    const registry = new PlantContentProviderRegistry([
      {
        metadata: testPlantContentProviderMetadata('fake-plant-provider-a', { jurisdiction: null }),
        adapter: registration('fake-plant-provider-a').adapter,
      },
    ]);
    expect(registry.get('fake-plant-provider-a')?.metadata.jurisdiction).toBeNull();
  });
});

describe('requireRegisteredPlantContentProvider', () => {
  it('returns the registration for a registered key and throws loudly for a ghost key', () => {
    const a = registration('fake-plant-provider-a');
    const registry = new PlantContentProviderRegistry([a]);

    expect(requireRegisteredPlantContentProvider(registry, 'fake-plant-provider-a')).toBe(a);
    expect(() => requireRegisteredPlantContentProvider(registry, 'ghost-provider')).toThrow(
      InternalError,
    );
  });
});
