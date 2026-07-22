'use client';

import type { LivenessResult, ReadinessResult } from '@verdery/api-contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createBrowserApiClient, createHealthGateway, type ApiResult } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, StatusPill, VisuallyHidden } from '@/shared/ui/public';

import { FailureAlert } from './failure-alert';
import styles from './health-panel.module.css';

type PanelState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'loaded';
      readonly liveness: ApiResult<LivenessResult>;
      readonly readiness: ApiResult<ReadinessResult>;
    };

/**
 * Exercises the typed gateway against the operations health endpoints.
 *
 * It is a client component because it reflects live status rather than a
 * server-rendered snapshot, and because a failure to reach the API must be
 * shown as feature state rather than as a build or render failure.
 *
 * Source: architecture/web-application-design.md, sections "4. Rendering Model"
 * and "13. Error Boundaries".
 */
export function HealthPanel() {
  const { t } = useLocalization();
  const gateway = useMemo(() => createHealthGateway(createBrowserApiClient()), []);
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setState({ phase: 'loading' });

    void (async () => {
      const [liveness, readiness] = await Promise.all([
        gateway.readLiveness(controller.signal),
        gateway.readReadiness(controller.signal),
      ]);

      if (!controller.signal.aborted) {
        setState({ phase: 'loaded', liveness, readiness });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [gateway, attempt]);

  const refresh = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  const loading = state.phase === 'loading';

  return (
    <div className={styles['panel']}>
      <Button variant="primary" busy={loading} onClick={refresh}>
        {loading ? t('status.checking') : t('status.refresh')}
      </Button>

      {/* Status changes are announced rather than only shown. */}
      <VisuallyHidden liveRegion="polite">
        {loading ? t('status.announcementLoading') : t('status.announcementLoaded')}
      </VisuallyHidden>

      <div className={styles['probes']}>
        <Card title={t('status.liveness')}>
          {state.phase === 'loaded' &&
            (state.liveness.ok ? (
              <>
                <StatusPill tone="positive" label={t('status.stateAlive')} />
                <p className={styles['detail']}>
                  {t('status.version', { version: state.liveness.data.version })}
                </p>
              </>
            ) : (
              <FailureAlert failure={state.liveness} />
            ))}
        </Card>

        <Card title={t('status.readiness')}>
          {state.phase === 'loaded' &&
            (state.readiness.ok ? (
              <ReadinessDetail result={state.readiness.data} />
            ) : (
              <FailureAlert failure={state.readiness} />
            ))}
        </Card>
      </div>
    </div>
  );
}

function ReadinessDetail({ result }: { readonly result: ReadinessResult }) {
  const { t } = useLocalization();
  const ready = result.status === 'ready';

  return (
    <>
      <StatusPill
        tone={ready ? 'positive' : 'negative'}
        label={ready ? t('status.stateReady') : t('status.stateNotReady')}
      />
      <p className={styles['detail']}>{t('status.version', { version: result.version })}</p>
      <h3 className={styles['detail']}>{t('status.dependencies')}</h3>
      {result.dependencies.length === 0 ? (
        <p className={styles['detail']}>{t('status.dependenciesEmpty')}</p>
      ) : (
        <ul className={styles['dependencies']}>
          {result.dependencies.map((dependency) => (
            <li key={dependency.name} className={styles['dependency']}>
              <span>{dependency.name}</span>
              <StatusPill
                tone={dependency.status === 'available' ? 'positive' : 'negative'}
                label={
                  dependency.status === 'available'
                    ? t('status.dependencyAvailable')
                    : t('status.dependencyUnavailable')
                }
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
