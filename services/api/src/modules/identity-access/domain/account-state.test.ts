import { describe, expect, it } from 'vitest';
import type { AccountState } from './account-state.js';
import { isAccountUsable } from './account-state.js';

const STATES: readonly AccountState[] = [
  'pending',
  'active',
  'suspended',
  'deletion_requested',
  'disabled',
  'purged',
];

describe('isAccountUsable', () => {
  it('is true only for active', () => {
    for (const state of STATES) {
      expect(isAccountUsable(state)).toBe(state === 'active');
    }
  });
});
