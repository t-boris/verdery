import type { ReactNode } from 'react';

import { ApiQueryProvider } from '@/core/api/public';

import { ApplicationShell } from './application-shell';

/**
 * Layout for every route behind `middleware.ts`'s session-cookie check.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export default function ApplicationLayout({ children }: { readonly children: ReactNode }) {
  return (
    <ApiQueryProvider>
      <ApplicationShell>{children}</ApplicationShell>
    </ApiQueryProvider>
  );
}
