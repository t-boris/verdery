import { describe, expect, it } from 'vitest';

import { GARDEN_OBJECT_CATEGORIES, isGeometryTypeAllowedForCategory } from './object-category.js';

describe('GARDEN_OBJECT_CATEGORIES', () => {
  it('has no duplicate categories', () => {
    expect(new Set(GARDEN_OBJECT_CATEGORIES).size).toBe(GARDEN_OBJECT_CATEGORIES.length);
  });
});

describe('isGeometryTypeAllowedForCategory', () => {
  it('accepts a polygon lot boundary', () => {
    expect(isGeometryTypeAllowedForCategory('lot', 'Polygon')).toBe(true);
  });

  it('rejects a point lot boundary', () => {
    expect(isGeometryTypeAllowedForCategory('lot', 'Point')).toBe(false);
  });

  it('accepts a point tree trunk', () => {
    expect(isGeometryTypeAllowedForCategory('tree', 'Point')).toBe(true);
  });

  it('rejects a polygon tree trunk — the canopy is a separate optional field, not the primary geometry', () => {
    expect(isGeometryTypeAllowedForCategory('tree', 'Polygon')).toBe(false);
  });

  it('accepts a point or line string annotation', () => {
    expect(isGeometryTypeAllowedForCategory('annotation', 'Point')).toBe(true);
    expect(isGeometryTypeAllowedForCategory('annotation', 'LineString')).toBe(true);
  });

  it.each(GARDEN_OBJECT_CATEGORIES)(
    'every category allows at least one geometry type: %s',
    (category) => {
      const anyAllowed = ['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].some(
        (type) => isGeometryTypeAllowedForCategory(category, type as never),
      );
      expect(anyAllowed).toBe(true);
    },
  );
});
