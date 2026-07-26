import { describe, expect, it } from 'vitest';
import type { GardenAssignmentState } from './garden-assignment-state.js';
import { isValidGardenAssignmentTransition } from './garden-assignment-state.js';

const ALL_STATES: readonly GardenAssignmentState[] = ['active', 'ended', 'revoked'];

describe('isValidGardenAssignmentTransition', () => {
  it('allows an active assignment to end naturally or be revoked', () => {
    expect(isValidGardenAssignmentTransition('active', 'ended')).toBe(true);
    expect(isValidGardenAssignmentTransition('active', 'revoked')).toBe(true);
  });

  it('rejects every transition out of either terminal state', () => {
    for (const to of ALL_STATES) {
      expect(isValidGardenAssignmentTransition('ended', to)).toBe(false);
      expect(isValidGardenAssignmentTransition('revoked', to)).toBe(false);
    }
  });

  it('rejects a no-op transition', () => {
    for (const state of ALL_STATES) {
      expect(isValidGardenAssignmentTransition(state, state)).toBe(false);
    }
  });
});
