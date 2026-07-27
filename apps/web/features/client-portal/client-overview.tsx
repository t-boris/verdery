'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { formatInstant, useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import styles from './client-overview.module.css';
import { useClientGardenOverview } from './queries';
import { SnapshotDataList } from './snapshot-data-list';

/**
 * A client garden's accepted-garden overview (`getClientGardenOverview`).
 *
 * `overviewText` absent is the contract's own "absence, not error" design
 * (`ClientGardenOverview`'s own schema description) — rendered here as a
 * genuine "nothing published yet" state, never a spinner or an error, per
 * this work package's own instruction.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getClientGardenOverview`;
 * architecture/collaboration-and-client-sharing.md, section
 * "11. Publication Contents".
 */
export function ClientOverview({ clientGardenId }: { readonly clientGardenId: string }) {
  const { t, locale } = useLocalization();
  const query = useClientGardenOverview(clientGardenId);

  if (query.isPending) {
    return <p role="status">{t('clientPortal.overviewLoading')}</p>;
  }

  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('clientPortal.overviewRetry')}
        </Button>
      </div>
    );
  }

  const overview = query.data;

  return (
    <>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      {overview.overviewText === undefined ? (
        <p className={styles['empty']}>{t('clientPortal.overviewEmpty')}</p>
      ) : (
        <div className={styles['overview']}>
          <p className={styles['overviewText']}>{overview.overviewText}</p>
          {overview.snapshotData !== undefined && <SnapshotDataList data={overview.snapshotData} />}
          <div className={styles['meta']}>
            {overview.occurredAt !== undefined && (
              <span>
                {t('clientPortal.overviewAsOf', {
                  date: formatInstant(overview.occurredAt, locale),
                })}
              </span>
            )}
            {overview.publishedAt !== undefined && (
              <span>
                {t('clientPortal.overviewPublishedAt', {
                  date: formatInstant(overview.publishedAt, locale),
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
