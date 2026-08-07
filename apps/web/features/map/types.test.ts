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

describe('plant creation geometry', () => {
  it('traces the area occupied by a plant instead of dropping a point marker', () => {
    expect(CREATABLE_GEOMETRY_KIND.plant).toBe('polygon');
  });
});
