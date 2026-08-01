'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { ClientUpdateContentForm } from './client-update-content-form';
import styles from './client-update-detail.module.css';
import { ClientUpdateItemsPanel } from './client-update-items-panel';
import { ClientUpdateLifecycleControls } from './client-update-lifecycle-controls';
import { clientUpdateStateLabel, clientUpdateStateTone } from './labels';
import { useClientUpdate } from './queries';

export interface ClientUpdateDetailProps {
  readonly engagementId: string;
  readonly clientUpdateId: string;
}

/**
 * A single client update: its content (editable while `internal_draft`),
 * staged items, and the state-machine transitions valid from its current
 * state — the client-publication domain's equivalent of
 * `candidate-detail.tsx`.
 *
 * Every sub-panel reads the SAME `update` object this component fetches
 * once, rather than each re-fetching independently — unlike the garden
 * settings page's sibling-section composition, these panels are all facets
 * of one resource, not independent reads.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * packages/api-contracts/openapi.yaml, operation `getClientUpdate`.
 */
export function ClientUpdateDetail({ engagementId, clientUpdateId }: ClientUpdateDetailProps) {
  const { t } = useLocalization();
  const query = useClientUpdate(engagementId, clientUpdateId);

  if (query.isPending) {
    return <p role="status">{t('publications.loading')}</p>;
  }

  if (query.isLoadingError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  const update = query.data;

  return (
    <div className={styles['page']}>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      <div className={styles['summary']}>
        <h1 className={styles['title']}>{update.title}</h1>
        <StatusPill
          tone={clientUpdateStateTone(update.state)}
          label={t(clientUpdateStateLabel(update.state))}
        />
      </div>

      <Card title={t('publications.editTitle')}>
        {update.state === 'internal_draft' ? (
          <ClientUpdateContentForm engagementId={engagementId} update={update} />
        ) : (
          <p className={styles['summaryText']}>{update.summary}</p>
        )}
      </Card>

      <Card title={t('publications.itemsTitle')}>
        <ClientUpdateItemsPanel engagementId={engagementId} update={update} />
      </Card>

      {update.state !== 'withdrawn' && (
        <Card title={t('publications.lifecycleTitle')}>
          <ClientUpdateLifecycleControls engagementId={engagementId} update={update} />
        </Card>
      )}
    </div>
  );
}
