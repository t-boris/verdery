import { describe, expect, it } from 'vitest';
import type { PublicationState } from './publication-state.js';
import { isValidPublicationTransition } from './publication-state.js';

const ALL_STATES: readonly PublicationState[] = [
  'internal_draft',
  'ready_for_client',
  'published',
  'withdrawn',
];

describe('isValidPublicationTransition', () => {
  it('allows exactly the transitions the diagram draws', () => {
    expect(isValidPublicationTransition('internal_draft', 'ready_for_client')).toBe(true);
    expect(isValidPublicationTransition('ready_for_client', 'published')).toBe(true);
    expect(isValidPublicationTransition('published', 'withdrawn')).toBe(true);
  });

  it('rejects skipping a step in either direction', () => {
    expect(isValidPublicationTransition('internal_draft', 'published')).toBe(false);
    expect(isValidPublicationTransition('internal_draft', 'withdrawn')).toBe(false);
    expect(isValidPublicationTransition('ready_for_client', 'withdrawn')).toBe(false);
  });

  it('rejects reaching internal_draft from anywhere — a draft is only ever the start', () => {
    for (const from of ALL_STATES) {
      expect(isValidPublicationTransition(from, 'internal_draft')).toBe(false);
    }
  });

  it('rejects moving backwards one step at a time', () => {
    expect(isValidPublicationTransition('ready_for_client', 'internal_draft')).toBe(false);
    expect(isValidPublicationTransition('published', 'ready_for_client')).toBe(false);
    expect(isValidPublicationTransition('withdrawn', 'published')).toBe(false);
  });

  it('rejects every transition out of the one terminal state', () => {
    for (const to of ALL_STATES) {
      expect(isValidPublicationTransition('withdrawn', to)).toBe(false);
    }
  });

  it('rejects a no-op transition — every call names a real move', () => {
    for (const state of ALL_STATES) {
      expect(isValidPublicationTransition(state, state)).toBe(false);
    }
  });
});
