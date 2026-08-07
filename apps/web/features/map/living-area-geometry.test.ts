import { describe, expect, it } from 'vitest';

import { defaultLivingAreaGeometry } from './living-area-geometry';

describe('defaultLivingAreaGeometry', () => {
  it.each(['tree', 'plant'] as const)('creates %s as a closed editable circle', (category) => {
    const geometry = defaultLivingAreaGeometry(category, [10, 20]);

    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates[0]).toHaveLength(17);
    expect(geometry.coordinates[0]?.[0]).toEqual(geometry.coordinates[0]?.at(-1));
  });

  it('starts a tree with a larger area than an individual plant', () => {
    const treeEast = defaultLivingAreaGeometry('tree', [0, 0]).coordinates[0]?.[0]?.[0];
    const plantEast = defaultLivingAreaGeometry('plant', [0, 0]).coordinates[0]?.[0]?.[0];

    expect(treeEast).toBeGreaterThan(plantEast ?? 0);
  });
});
