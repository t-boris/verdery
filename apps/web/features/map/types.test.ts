import { describe, expect, it } from 'vitest';

import { existingObjectsAreInteractive } from './types';

describe('existingObjectsAreInteractive', () => {
  it('keeps accepted objects interactive only in select mode', () => {
    expect(existingObjectsAreInteractive('select')).toBe(true);
    expect(existingObjectsAreInteractive('create:structure')).toBe(false);
    expect(existingObjectsAreInteractive('create:fence')).toBe(false);
    expect(existingObjectsAreInteractive('create:plant')).toBe(false);
  });
});
