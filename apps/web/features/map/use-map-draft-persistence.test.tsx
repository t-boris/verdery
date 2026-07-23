import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLocalDraft } from '@/core/drafts/public';

import { MapEditorStoreProvider, useMapEditorStore } from './editor-store';
import { useMapDraftPersistence } from './use-map-draft-persistence';

function useTestSubject(gardenId: string) {
  const store = useMapEditorStore();
  const draft = useMapDraftPersistence(gardenId, store);
  return { store, draft };
}

function wrapper({ children }: { readonly children: ReactNode }) {
  return <MapEditorStoreProvider>{children}</MapEditorStoreProvider>;
}

function renderMapDraft(gardenId = 'garden-1') {
  return renderHook(() => useTestSubject(gardenId), { wrapper });
}

afterEach(() => {
  window.localStorage.clear();
});

describe('useMapDraftPersistence', () => {
  it('survives a simulated reload: an in-progress shape is restored to a fresh store instance', () => {
    vi.useFakeTimers();

    const first = renderMapDraft();
    act(() => first.result.current.store.setTool('create:fence'));
    act(() =>
      first.result.current.store.setDraftPoints([
        [0, 0],
        [3, 0],
        [3, 4],
      ]),
    );
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    first.unmount();

    const second = renderMapDraft();

    expect(second.result.current.store.state.tool).toBe('create:fence');
    expect(second.result.current.store.state.draftPoints).toEqual([
      [0, 0],
      [3, 0],
      [3, 4],
    ]);
    expect(second.result.current.draft.recovered).toBe(true);
  });

  it('finds nothing to recover for a session that never drew anything', () => {
    const { result } = renderMapDraft();

    expect(result.current.store.state.draftPoints).toEqual([]);
    expect(result.current.draft.recovered).toBe(false);
  });

  it('clears the persisted draft once the shape is finished, so a later mount finds nothing', () => {
    vi.useFakeTimers();

    const first = renderMapDraft();
    act(() => first.result.current.store.setTool('create:fence'));
    act(() =>
      first.result.current.store.setDraftPoints([
        [0, 0],
        [3, 0],
      ]),
    );
    vi.advanceTimersByTime(1000);

    // Mirrors what `finishDraft`/`cancelDraft` (`use-map-editor-actions.ts`)
    // do on success or cancellation: return the tool to `select`, which the
    // reducer itself clears `draftPoints` for.
    act(() => first.result.current.store.setTool('select'));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    expect(loadLocalDraft('map.editSession', 'garden-1', 1)).toBeNull();

    first.unmount();
    const second = renderMapDraft();
    expect(second.result.current.draft.recovered).toBe(false);
  });

  it('clears the persisted draft once a pending gate geometry is resolved (setPendingGateGeometry back to null)', () => {
    vi.useFakeTimers();

    const first = renderMapDraft();
    act(() =>
      first.result.current.store.setPendingGateGeometry({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      }),
    );
    vi.advanceTimersByTime(1000);
    expect(loadLocalDraft('map.editSession', 'garden-1', 1)).not.toBeNull();

    act(() => first.result.current.store.setPendingGateGeometry(null));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    expect(loadLocalDraft('map.editSession', 'garden-1', 1)).toBeNull();
  });

  it('discardRecoveredDraft returns the tool to select and hides the recovered notice', () => {
    vi.useFakeTimers();
    const first = renderMapDraft();
    act(() => first.result.current.store.setTool('create:fence'));
    act(() =>
      first.result.current.store.setDraftPoints([
        [0, 0],
        [3, 0],
      ]),
    );
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    first.unmount();

    const second = renderMapDraft();
    expect(second.result.current.draft.recovered).toBe(true);

    act(() => second.result.current.draft.discardRecoveredDraft());

    expect(second.result.current.store.state.tool).toBe('select');
    expect(second.result.current.store.state.draftPoints).toEqual([]);
    expect(loadLocalDraft('map.editSession', 'garden-1', 1)).toBeNull();
  });
});
