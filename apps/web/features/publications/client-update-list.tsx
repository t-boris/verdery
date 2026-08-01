'use client';

import type { ClientUpdate } from '@verdery/api-contracts';
import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import styles from './client-update-list.module.css';
import { clientUpdateStateLabel, clientUpdateStateTone } from './labels';
import { useClientUpdates } from './queries';

/**
 * Every client update on this engagement, in any state, newest first
 * (`listClientUpdates`) — the entry point to each update's own detail page,
 * where content, staged items, and the lifecycle transitions live.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listClientUpdates`.
 */
export function ClientUpdateList({ engagementId }: { readonly engagementId: string }) {
  const { t } = useLocalization();
  const query = useClientUpdates(engagementId);

  return (
    <Card title={t('publications.pageTitle')}>
      {query.isPending && <p role="status">{t('publications.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('publications.retry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError &&
        query.data !== undefined &&
        (query.data.items.length === 0 ? (
          <p className={styles['empty']}>{t('publications.empty')}</p>
        ) : (
          <ul className={styles['list']}>
            {query.data.items.map((update) => (
              <ClientUpdateRow key={update.id} engagementId={engagementId} update={update} />
            ))}
          </ul>
        ))}
    </Card>
  );
}

function ClientUpdateRow({
  engagementId,
  update,
}: {
  readonly engagementId: string;
  readonly update: ClientUpdate;
}) {
  const { t } = useLocalization();

  return (
    <li className={styles['row']}>
      <span className={styles['title']}>{update.title}</span>
      <StatusPill
        tone={clientUpdateStateTone(update.state)}
        label={t(clientUpdateStateLabel(update.state))}
      />
      <Link href={`/application/engagements/${engagementId}/updates/${update.id}`}>
        {t('publications.open')}
      </Link>
    </li>
  );
}
