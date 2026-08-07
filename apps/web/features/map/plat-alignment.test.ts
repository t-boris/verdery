import type { PlatReading } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { alignedPlatReading } from './plat-alignment';

const reading = {
  boundary: {
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
    areaSquareMetres: 100,
    closureErrorMetres: 0.1,
    closes: true,
    recoveredBearing: null,
  },
  objects: [
    {
      category: 'structure',
      label: 'House',
      geometry: { type: 'Point', coordinates: [5, 5] },
      confidence: 1,
      areaSquareMetres: 0,
    },
  ],
} as unknown as PlatReading;

describe('alignedPlatReading', () => {
  it('moves and rotates the lot and every object as one rigid set', () => {
    const aligned = alignedPlatReading({
      reading,
      transform: { translation: [20, -5], rotationDegrees: 90, scale: 1 },
    });

    const house = aligned.objects[0]?.geometry;
    expect(house?.type).toBe('Point');
    if (house?.type === 'Point') expect(house.coordinates).toEqual([25, 0]);
    const boundary = aligned.boundary?.geometry;
    expect(boundary?.type).toBe('Polygon');
    if (boundary?.type === 'Polygon') {
      expect(boundary.coordinates[0]?.[0]?.[0]).toBeCloseTo(30);
      expect(boundary.coordinates[0]?.[0]?.[1]).toBeCloseTo(-5);
    }
    expect(aligned.boundary?.areaSquareMetres).toBe(100);
  });
});
