import { afterEach, describe, expect, it } from 'vitest';

import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from './local-draft-store';

afterEach(() => {
  window.localStorage.clear();
});

interface SamplePayload {
  readonly title: string;
}

describe('saveLocalDraft / loadLocalDraft', () => {
  it('round-trips a draft under its schema version', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, { title: 'Weed bed' });

    expect(loadLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1)).toEqual({
      title: 'Weed bed',
    });
  });

  it('returns null for a draft type/scope with nothing stored', () => {
    expect(loadLocalDraft('tasks.createManualTask', 'garden-1', 1)).toBeNull();
  });

  it('discards a stored draft written under a different schema version, never partially applying it', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, { title: 'Weed bed' });

    expect(loadLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 2)).toBeNull();
  });

  it('keeps drafts of different scopes independent', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, {
      title: 'Garden 1 task',
    });
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-2', 1, {
      title: 'Garden 2 task',
    });

    expect(loadLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1)).toEqual({
      title: 'Garden 1 task',
    });
    expect(loadLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-2', 1)).toEqual({
      title: 'Garden 2 task',
    });
  });

  it('keeps drafts of different draft types independent within the same scope', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, { title: 'Task draft' });
    saveLocalDraft<SamplePayload>('plants.addPlant', 'garden-1', 1, { title: 'Plant draft' });

    expect(loadLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1)).toEqual({
      title: 'Task draft',
    });
    expect(loadLocalDraft<SamplePayload>('plants.addPlant', 'garden-1', 1)).toEqual({
      title: 'Plant draft',
    });
  });

  it('treats a corrupted stored value as absent rather than throwing', () => {
    window.localStorage.setItem('verdery.draft.tasks.createManualTask.garden-1', 'not json');

    expect(loadLocalDraft('tasks.createManualTask', 'garden-1', 1)).toBeNull();
  });
});

describe('clearLocalDraft', () => {
  it('removes a stored draft so a later load finds nothing', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, { title: 'Weed bed' });

    clearLocalDraft('tasks.createManualTask', 'garden-1');

    expect(loadLocalDraft('tasks.createManualTask', 'garden-1', 1)).toBeNull();
  });

  it('does nothing, and does not throw, when there is nothing stored', () => {
    expect(() => clearLocalDraft('tasks.createManualTask', 'garden-1')).not.toThrow();
  });
});
