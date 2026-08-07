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
  it('traces the area occupied by plants and trees instead of dropping point markers', () => {
    expect(CREATABLE_GEOMETRY_KIND.plant).toBe('polygon');
    expect(CREATABLE_GEOMETRY_KIND.tree).toBe('polygon');
  });
});
