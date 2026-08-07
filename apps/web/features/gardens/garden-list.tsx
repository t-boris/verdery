'use client';

import type { Garden } from '@verdery/api-contracts';
import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { formatInstant, useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, HomeIcon, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { useGardens, useRestoreGardenDeletion } from './queries';
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
  const { t, locale } = useLocalization();
  const restore = useRestoreGardenDeletion(garden.id);

  // The settings screen redirects away from a garden in this state, so the
  // list is the ONLY place it is still reachable — which makes it the only
  // place the recovery window can be acted on.
  const isRecoverable = garden.lifecycleState === 'deletionRequested';

  return (
    <li className={styles['item']}>
      <Link className={styles['link']} href={`/application/gardens/${garden.id}`}>
        <span className={styles['recordIcon']}>
          <HomeIcon size={18} />
        </span>
        <span>{garden.name}</span>
      </Link>
      <span className={styles['meta']}>
        <StatusPill
          tone={garden.lifecycleState === 'active' ? 'positive' : 'neutral'}
          label={t(lifecycleLabel(garden.lifecycleState))}
        />
        <span>{t(roleLabel(garden.callerRole))}</span>
      </span>
      {isRecoverable && (
        <span className={styles['recovery']}>
          {/* The deadline is stated, not implied: "deletion requested" alone
              does not tell anyone how long they have to change their mind. */}
          {garden.recoveryDeadlineAt !== undefined && (
            <span className={styles['deadline']}>
              {t('gardens.recoveryDeadline', {
                date: formatInstant(garden.recoveryDeadlineAt, locale),
              })}
            </span>
          )}
          <Button
            variant="secondary"
            disabled={restore.isPending}
            onClick={() => {
              restore.mutate(garden.revision);
            }}
          >
            {t('gardens.restoreDeletion')}
          </Button>
          {restore.isError && <FailureAlert failure={restore.error.failure} />}
        </span>
      )}
    </li>
  );
}
