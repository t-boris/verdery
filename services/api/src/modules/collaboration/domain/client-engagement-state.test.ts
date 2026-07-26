import { describe, expect, it } from 'vitest';
import type { ClientEngagementState } from './client-engagement-state.js';
import { isValidClientEngagementTransition } from './client-engagement-state.js';

const ALL_STATES: readonly ClientEngagementState[] = ['draft', 'active', 'ended', 'revoked'];

describe('isValidClientEngagementTransition', () => {
  it('allows exactly the transitions the diagram draws', () => {
    expect(isValidClientEngagementTransition('draft', 'active')).toBe(true);
    expect(isValidClientEngagementTransition('draft', 'revoked')).toBe(true);
    expect(isValidClientEngagementTransition('active', 'ended')).toBe(true);
    expect(isValidClientEngagementTransition('active', 'revoked')).toBe(true);
  });

  it('rejects reaching draft from anywhere — a draft is only ever the start', () => {
    for (const from of ALL_STATES) {
      expect(isValidClientEngagementTransition(from, 'draft')).toBe(false);
    }
  });

  it('rejects every transition out of the two terminal states', () => {
    for (const to of ALL_STATES) {
      expect(isValidClientEngagementTransition('ended', to)).toBe(false);
      expect(isValidClientEngagementTransition('revoked', to)).toBe(false);
    }
  });

  it('rejects skipping activation: draft cannot reach ended directly', () => {
    expect(isValidClientEngagementTransition('draft', 'ended')).toBe(false);
  });

  it('rejects a no-op transition — every call names a real move', () => {
    for (const state of ALL_STATES) {
      expect(isValidClientEngagementTransition(state, state)).toBe(false);
    }
  });
});
