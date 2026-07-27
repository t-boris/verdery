'use client';

import type { ClientGarden } from '@verdery/api-contracts';
import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import styles from './client-garden-list.module.css';
import { useClientGardens } from './queries';

/**
 * Every garden the signed-in client currently has an active connection to
 * (`listClientGardens`) — the client-portal mirror of `GardenList`/
 * `OrganizationList`. A client may hold more than one active engagement (a
 * second property, or a second service provider), so this is a real
 * switcher, not a single-item formality: `ClientGardenListResult.items` is
 * an unbounded array in the contract, and nothing here assumes a one-
 * client-one-garden shape.
 *
 * Deliberately read-only, like every other view in this feature: each row
 * is a link into that garden's own overview, nothing more.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listClientGardens`.
 */
export function ClientGardenList() {
  const { t } = useLocalization();
  const query = useClientGardens();

  if (query.isPending) {
    return <p role="status">{t('clientPortal.gardensLoading')}</p>;
  }

  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('clientPortal.gardensRetry')}
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
        <p className={styles['empty']}>{t('clientPortal.gardensEmpty')}</p>
      ) : (
        <ul className={styles['list']}>
          {query.data.items.map((garden) => (
            <ClientGardenListItem key={garden.id} garden={garden} />
          ))}
        </ul>
      )}
    </>
  );
}

function ClientGardenListItem({ garden }: { readonly garden: ClientGarden }) {
  return (
    <li className={styles['item']}>
      <Link className={styles['link']} href={`/client-portal/${garden.id}`}>
        {garden.name}
      </Link>
    </li>
  );
}
