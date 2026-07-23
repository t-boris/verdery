import { describe, expect, it } from 'vitest';

import type { WireGeoreference } from '@/core/api/public';

import { scaleStatusFor } from './scale-status';

function georeference(overrides?: Partial<WireGeoreference>): WireGeoreference {
  return {
    localAnchor: [0, 0],
    geographicAnchor: [-122.4, 37.7],
    rotationDegrees: 0,
    scaleCorrection: 1,
    provenance: 'userMeasurement',
    method: 'gpsAnchor',
    revision: 1,
    ...overrides,
  };
}

describe('scaleStatusFor', () => {
  it('reports no scale set when the garden has no georeference', () => {
    expect(scaleStatusFor(undefined)).toEqual({ key: 'map.scale.noScale' });
  });

  it('reports georeferenced with an accuracy clause when accuracyMetres is present', () => {
    expect(scaleStatusFor(georeference({ accuracyMetres: 2.5 }))).toEqual({
      key: 'map.scale.georeferencedAccuracy',
      args: { accuracyMetres: 2.5 },
    });
  });

  it('omits the accuracy clause when accuracyMetres is absent', () => {
    expect(scaleStatusFor(georeference())).toEqual({ key: 'map.scale.georeferenced' });
  });
});
