import { describe, expect, it } from 'vitest';

import { geographicToLocalMetres, localMetresToGeographic } from './geographic-transform.js';

describe('shared geographic transform', () => {
  it('round-trips local vertices through the same transform used by aerial backdrops', () => {
    const georeference = {
      localAnchor: [12, -8] as const,
      geographicAnchor: [-87.65, 41.88] as const,
      rotationDegrees: 27,
      scaleCorrection: 1.03,
    };
    const local = [45.25, 81.75] as const;
    const roundTrip = geographicToLocalMetres(
      localMetresToGeographic(local, georeference),
      georeference,
    );
    expect(roundTrip[0]).toBeCloseTo(local[0], 8);
    expect(roundTrip[1]).toBeCloseTo(local[1], 8);
  });
});
