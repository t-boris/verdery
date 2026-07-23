import { describe, expect, it } from 'vitest';

import { SAVE_STATUS_LABEL_KEY, deriveSaveStatus, type SaveStatus } from './save-status';

describe('deriveSaveStatus', () => {
  it('maps every TanStack mutation status onto the matching save status', () => {
    expect(deriveSaveStatus('idle')).toBe('idle');
    expect(deriveSaveStatus('pending')).toBe('saving');
    expect(deriveSaveStatus('success')).toBe('saved');
    expect(deriveSaveStatus('error')).toBe('failed');
  });
});

describe('SAVE_STATUS_LABEL_KEY', () => {
  it('has a message key for every non-idle status', () => {
    const nonIdle: readonly Exclude<SaveStatus, 'idle'>[] = ['saving', 'saved', 'failed'];
    for (const status of nonIdle) {
      expect(SAVE_STATUS_LABEL_KEY[status]).toBeTruthy();
    }
  });
});
