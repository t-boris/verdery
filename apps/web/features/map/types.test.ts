import { describe, expect, it } from 'vitest';

import { CREATABLE_GEOMETRY_KIND, existingObjectsAreInteractive } from './types';

describe('existingObjectsAreInteractive', () => {
  it('keeps accepted objects interactive only in select mode', () => {
    expect(existingObjectsAreInteractive('select')).toBe(true);
    expect(existingObjectsAreInteractive('create:structure')).toBe(false);
    expect(existingObjectsAreInteractive('create:fence')).toBe(false);
    expect(existingObjectsAreInteractive('create:plant')).toBe(false);
  });
});

describe('living plant creation geometry', () => {
  it('places plants and trees with one click instead of entering polygon drafting', () => {
    expect(CREATABLE_GEOMETRY_KIND.plant).toBe('point');
    expect(CREATABLE_GEOMETRY_KIND.tree).toBe('point');
  });
});
