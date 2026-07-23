import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useIsOnline } from './network-status';

// `onlineManager` is a module-level singleton shared by the whole test file;
// every test must leave it "online" so it does not leak into the next one.
afterEach(() => {
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
});

describe('useIsOnline', () => {
  it('reports the browser as online by default', () => {
    const { result } = renderHook(() => useIsOnline());
    expect(result.current).toBe(true);
  });

  it('reflects a browser "offline" event', () => {
    const { result } = renderHook(() => useIsOnline());

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe(false);
  });

  it('reflects reconnection after an "online" event follows an "offline" one', () => {
    const { result } = renderHook(() => useIsOnline());

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('shares state with `onlineManager` itself, the same signal TanStack Query pauses on', () => {
    const { result } = renderHook(() => useIsOnline());

    act(() => {
      onlineManager.setOnline(false);
    });

    expect(result.current).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);
  });
});
