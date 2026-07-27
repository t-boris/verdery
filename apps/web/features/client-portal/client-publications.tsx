'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { ClientPublicationCard } from './client-publication-card';
import styles from './client-publications.module.css';
import { useClientPublications } from './queries';

/**
 * Every visible publication version for a client garden
 * (`listClientPublications`), newest first, grouped by version — genuinely
 * distinct from `ClientTimeline`'s flattened, oldest-first rendering of the
 * same underlying facts (see that component's own doc comment).
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listClientPublications`.
 */
export function ClientPublications({ clientGardenId }: { readonly clientGardenId: string }) {
  const { t } = useLocalization();
  const query = useClientPublications(clientGardenId);

  if (query.isPending) {
    return <p role="status">{t('clientPortal.publicationsLoading')}</p>;
  }

  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('clientPortal.publicationsRetry')}
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
        <p className={styles['empty']}>{t('clientPortal.publicationsEmpty')}</p>
      ) : (
        <ul className={styles['list']}>
          {query.data.items.map((publication) => (
            <ClientPublicationCard key={publication.id} publication={publication} />
          ))}
        </ul>
      )}
    </>
  );
}
