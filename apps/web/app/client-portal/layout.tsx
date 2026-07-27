import type { ReactNode } from 'react';

import { ApiQueryProvider } from '@/core/api/public';

import { ClientShell } from './client-shell';

/**
 * Layout for the `/client-portal` route group (P9C-WEB-01) — a top-level,
 * authenticated route group SEPARATE from `/application`, not nested under
 * it. A client-portal caller may hold zero operational access at all (no
 * garden membership, no organization membership — only a
 * `client_access_grant`), so nesting under `/application` would put
 * `ApplicationShell`'s Gardens/Organizations navigation — features such a
 * caller cannot use — in front of them. `proxy.ts` gates this route group
 * behind the SAME session cookie `/application` uses; only the shell and
 * its navigation differ.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "14. Web and Native Surfaces"; implementation-plan.md work package
 * P9C-WEB-01.
 */
export default function ClientLayout({ children }: { readonly children: ReactNode }) {
  return (
    <ApiQueryProvider>
      <ClientShell>{children}</ClientShell>
    </ApiQueryProvider>
  );
}
