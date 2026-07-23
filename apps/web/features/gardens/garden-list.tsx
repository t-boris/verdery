'use client';

import type { Garden } from '@verdery/api-contracts';
import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { useGardens } from './queries';
import styles from './garden-list.module.css';
import { lifecycleLabel, roleLabel } from './labels';

/**
 * Every garden the signed-in profile has active membership on.
 *
 * Source: implementation-plan.md work package P2-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listGardens`.
 */
export function GardenList() {
  const { t } = useLocalization();
  const query = useGardens();

  if (query.isPending) {
    return <p role="status">{t('gardens.loading')}</p>;
  }

  // `isLoadingError` is TanStack Query's own name for a failed *first* load —
  // there is no cached data to fall back to, so the full failure state is
  // all there is to show. A failed *background* refetch instead sets
  // `isRefetchError`, with `query.data` still holding the last successful
  // result; that case falls through to the rendering below with
  // `StaleIndicator` layered over the still-visible data, per architecture
  // doc section "9. Online-First Behavior" ("Existing loaded data remains
  // visible with a stale indicator" — data must never be replaced by an
  // error screen just because connectivity was lost).
  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('gardens.retry')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      {query.data.items.length === 0 ? (
        <p className={styles['empty']}>{t('gardens.empty')}</p>
      ) : (
        <ul className={styles['list']}>
          {query.data.items.map((garden) => (
            <GardenListItem key={garden.id} garden={garden} />
          ))}
        </ul>
      )}
    </>
  );
}

function GardenListItem({ garden }: { readonly garden: Garden }) {
  const { t } = useLocalization();

  return (
    <li className={styles['item']}>
      <Link className={styles['link']} href={`/application/gardens/${garden.id}`}>
        {garden.name}
      </Link>
      <span className={styles['meta']}>
        <StatusPill
          tone={garden.lifecycleState === 'active' ? 'positive' : 'neutral'}
          label={t(lifecycleLabel(garden.lifecycleState))}
        />
        <span>{t(roleLabel(garden.callerRole))}</span>
      </span>
    </li>
  );
}
