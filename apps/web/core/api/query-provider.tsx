'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * One `QueryClient` per browser session, created lazily in `useState` so
 * server rendering and the first client render do not each construct their
 * own — a `useState` initializer runs once per component instance, unlike a
 * module-level singleton, which would leak cached data across users on the
 * server.
 *
 * Source: architecture/web-application-design.md, section "6. State Ownership".
 */
export function ApiQueryProvider({ children }: { readonly children: ReactNode }) {
  const [client] = useState(() => new QueryClient());

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
