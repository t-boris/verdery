'use client';

import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * Reads and subscribes to browser connectivity.
 *
 * Reuses TanStack Query's own `onlineManager` singleton rather than a second,
 * independent `navigator.onLine`/`window` `online`/`offline` listener pair:
 * `onlineManager` already exists as part of this application's own
 * `@tanstack/react-query` dependency (`core/api/query-provider.tsx`), it is
 * already the exact signal the query client itself uses to pause queries and
 * mutations under the default `networkMode: 'online'`, and hand-rolling a
 * second copy of the same `window.addEventListener('online' | 'offline', …)`
 * wiring would risk the two ever disagreeing about whether the browser is
 * online. This was confirmed to be genuinely present (not assumed) by
 * reading `onlineManager`'s own source in `@tanstack/query-core` before
 * building this.
 *
 * `useSyncExternalStore` is used instead of `useState` plus a manual
 * subscribe-in-`useEffect` so a concurrent-mode render always reads a
 * consistent value and so this hook needs no store of its own.
 *
 * Source: architecture/web-application-design.md, section "9. Online-First
 * Behavior" ("Existing loaded data remains visible with a stale indicator").
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (callback) => onlineManager.subscribe(callback),
    () => onlineManager.isOnline(),
    // The server has no network concept of its own; assume online so
    // server-rendered markup never shows an offline indicator that the first
    // client render then has to immediately correct.
    () => true,
  );
}
