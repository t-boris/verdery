import { GARDEN_OBJECT_CATEGORIES } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import { styleForCategory } from './category-style';

describe('map category presentation', () => {
  it('uses a distinct stroke color for every object category', () => {
    const colors = GARDEN_OBJECT_CATEGORIES.map((category) => styleForCategory(category).stroke);

    expect(new Set(colors).size).toBe(GARDEN_OBJECT_CATEGORIES.length);
  });

  it('keeps a non-color category marker for every object category', () => {
    for (const category of GARDEN_OBJECT_CATEGORIES) {
      expect(styleForCategory(category).glyph).not.toBe('');
    }
  });
});
