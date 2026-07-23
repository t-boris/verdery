'use client';

import { isConnectivityFailure, type ApiFailure } from '@/core/api/public';
import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';

import { Alert } from './alert';

export interface StaleIndicatorProps {
  /**
   * The most recent failure for the data this indicator covers, if any —
   * only its connectivity classification is read (`kind === 'transport'`).
   * Omit or pass `null` when there is nothing to report, e.g. a form with no
   * background query of its own.
   */
  readonly failure?: ApiFailure | null;
}

/**
 * Layers a "may be out of date" notice over already-rendered content — it
 * never replaces it, unlike `FailureAlert`. Renders nothing when the
 * browser is online and there is no connectivity-related failure to report.
 *
 * Shown when either is true: the browser itself is offline, or the last
 * request for this data failed for a connectivity reason even though the
 * browser still believes it is online (a reachable network with an
 * unreachable API, for instance — `core/api/failure.ts`'s
 * `isConnectivityFailure`).
 *
 * Source: architecture/web-application-design.md, section "9. Online-First
 * Behavior" ("Existing loaded data remains visible with a stale indicator").
 */
export function StaleIndicator({ failure = null }: StaleIndicatorProps) {
  const isOnline = useIsOnline();
  const { t } = useLocalization();

  const isStale = !isOnline || (failure !== null && isConnectivityFailure(failure));
  if (!isStale) {
    return null;
  }

  return (
    <Alert tone="info" title={t('connectivity.staleTitle')}>
      <p>{t('connectivity.staleDescription')}</p>
    </Alert>
  );
}
