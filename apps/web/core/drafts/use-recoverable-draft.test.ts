import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLocalDraft, saveLocalDraft } from './local-draft-store';
import { useRecoverableDraft } from './use-recoverable-draft';

afterEach(() => {
  window.localStorage.clear();
});

interface SamplePayload {
  readonly title: string;
}

describe('useRecoverableDraft', () => {
  it('finds nothing to recover when no draft was ever saved', () => {
    const { result } = renderHook(() =>
      useRecoverableDraft<SamplePayload>({
        draftType: 'tasks.createManualTask',
        scopeKey: 'garden-1',
        schemaVersion: 1,
        payload: { title: '' },
        hasUnsavedInput: false,
      }),
    );

    expect(result.current.recoveredPayload).toBeNull();
    expect(result.current.recovered).toBe(false);
  });

  it('surfaces a matching-schema draft saved by an earlier session as recoveredPayload', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, {
      title: 'Weed the north bed',
    });

    const { result } = renderHook(() =>
      useRecoverableDraft<SamplePayload>({
        draftType: 'tasks.createManualTask',
        scopeKey: 'garden-1',
        schemaVersion: 1,
        payload: { title: '' },
        hasUnsavedInput: false,
      }),
    );

    expect(result.current.recoveredPayload).toEqual({ title: 'Weed the north bed' });
  });

  it('does not surface a draft saved under a different schema version', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, {
      title: 'Weed the north bed',
    });

    const { result } = renderHook(() =>
      useRecoverableDraft<SamplePayload>({
        draftType: 'tasks.createManualTask',
        scopeKey: 'garden-1',
        schemaVersion: 2,
        payload: { title: '' },
        hasUnsavedInput: false,
      }),
    );

    expect(result.current.recoveredPayload).toBeNull();
  });

  it('acknowledgeRecovered consumes the recovered payload and flips `recovered` on', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, {
      title: 'Weed the north bed',
    });

    const { result } = renderHook(() =>
      useRecoverableDraft<SamplePayload>({
        draftType: 'tasks.createManualTask',
        scopeKey: 'garden-1',
        schemaVersion: 1,
        payload: { title: '' },
        hasUnsavedInput: false,
      }),
    );

    act(() => result.current.acknowledgeRecovered());

    expect(result.current.recoveredPayload).toBeNull();
    expect(result.current.recovered).toBe(true);
  });

  it('dismissRecovered clears the stored draft so it is not found again on a later mount', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, {
      title: 'Weed the north bed',
    });

    const { result } = renderHook(() =>
      useRecoverableDraft<SamplePayload>({
        draftType: 'tasks.createManualTask',
        scopeKey: 'garden-1',
        schemaVersion: 1,
        payload: { title: '' },
        hasUnsavedInput: false,
      }),
    );

    act(() => result.current.dismissRecovered());

    expect(loadLocalDraft('tasks.createManualTask', 'garden-1', 1)).toBeNull();
    expect(result.current.recovered).toBe(false);
  });

  it('persists a changed payload to storage, debounced, only while hasUnsavedInput is true', () => {
    vi.useFakeTimers();

    const { rerender } = renderHook(
      (props: { payload: SamplePayload; hasUnsavedInput: boolean }) =>
        useRecoverableDraft<SamplePayload>({
          draftType: 'tasks.createManualTask',
          scopeKey: 'garden-1',
          schemaVersion: 1,
          ...props,
        }),
      { initialProps: { payload: { title: '' }, hasUnsavedInput: false } },
    );

    // Untouched form: nothing is persisted even after the debounce window.
    // Advancing fake timers here only lets a `setTimeout` fire a plain
    // `localStorage` write — it triggers no React state update of its own,
    // so it needs no `act()` wrapper (unlike the hook's own state changes,
    // e.g. `acknowledgeRecovered`, exercised in the tests above).
    vi.advanceTimersByTime(1000);
    expect(loadLocalDraft('tasks.createManualTask', 'garden-1', 1)).toBeNull();

    rerender({ payload: { title: 'Weed the north bed' }, hasUnsavedInput: true });
    vi.advanceTimersByTime(1000);

    expect(loadLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1)).toEqual({
      title: 'Weed the north bed',
    });

    vi.useRealTimers();
  });

  it('clears a stored draft as soon as hasUnsavedInput turns false, not merely stops saving it', () => {
    vi.useFakeTimers();

    const { rerender } = renderHook(
      (props: { payload: SamplePayload; hasUnsavedInput: boolean }) =>
        useRecoverableDraft<SamplePayload>({
          draftType: 'map.editSession',
          scopeKey: 'garden-1',
          schemaVersion: 1,
          ...props,
        }),
      { initialProps: { payload: { title: 'in progress' }, hasUnsavedInput: true } },
    );
    vi.advanceTimersByTime(1000);
    expect(loadLocalDraft('map.editSession', 'garden-1', 1)).toEqual({ title: 'in progress' });

    // The map editor finishing or cancelling its in-progress shape looks
    // exactly like this: `hasUnsavedInput` drops to false without the
    // caller ever calling `clearDraft` itself.
    rerender({ payload: { title: 'in progress' }, hasUnsavedInput: false });

    expect(loadLocalDraft('map.editSession', 'garden-1', 1)).toBeNull();

    vi.useRealTimers();
  });

  it('clearDraft removes the persisted draft, e.g. after a successful submit', () => {
    saveLocalDraft<SamplePayload>('tasks.createManualTask', 'garden-1', 1, {
      title: 'Weed the north bed',
    });

    const { result } = renderHook(() =>
      useRecoverableDraft<SamplePayload>({
        draftType: 'tasks.createManualTask',
        scopeKey: 'garden-1',
        schemaVersion: 1,
        payload: { title: 'Weed the north bed' },
        hasUnsavedInput: true,
      }),
    );

    act(() => result.current.clearDraft());

    expect(loadLocalDraft('tasks.createManualTask', 'garden-1', 1)).toBeNull();
  });
});
