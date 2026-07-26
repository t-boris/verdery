'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { CreateClientEngagementForm } from './create-client-engagement-form';
import styles from './organization-members.module.css';
import { OrganizationClientEngagementRow } from './organization-client-engagement-row';
import { useOrganization, useOrganizationClientEngagements } from './queries';

export interface OrganizationClientEngagementsProps {
  readonly organizationId: string;
}

/**
 * Every client engagement this organization holds, in any state, newest
 * first (`listOrganizationClientEngagements`, any active member may read),
 * with creation and the activate/end/revoke lifecycle reserved to an
 * `organizationAdmin` caller (`manageEngagement`).
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listOrganizationClientEngagements`.
 */
export function OrganizationClientEngagements({
  organizationId,
}: OrganizationClientEngagementsProps) {
  const { t } = useLocalization();
  const roleQuery = useOrganization(organizationId);
  const engagementsQuery = useOrganizationClientEngagements(organizationId);

  const callerIsAdmin = roleQuery.data?.callerRole === 'organizationAdmin';

  return (
    <div className={styles['list']}>
      <Card title={t('engagements.orgSectionTitle')}>
        {engagementsQuery.isPending && <p role="status">{t('engagements.loading')}</p>}

        {engagementsQuery.isLoadingError && (
          <div className={styles['errorState']}>
            <FailureAlert failure={engagementsQuery.error.failure} />
            <Button variant="secondary" onClick={() => void engagementsQuery.refetch()}>
              {t('engagements.retry')}
            </Button>
          </div>
        )}

        {!engagementsQuery.isLoadingError && (
          <StaleIndicator
            failure={engagementsQuery.isError ? engagementsQuery.error.failure : null}
          />
        )}
        {engagementsQuery.isRefetchError &&
          !isConnectivityFailure(engagementsQuery.error.failure) && (
            <FailureAlert failure={engagementsQuery.error.failure} />
          )}

        {!engagementsQuery.isLoadingError &&
          engagementsQuery.data !== undefined &&
          (engagementsQuery.data.items.length === 0 ? (
            <p className={styles['notice']}>{t('engagements.empty')}</p>
          ) : (
            <ul className={styles['list']}>
              {engagementsQuery.data.items.map((engagement) => (
                <OrganizationClientEngagementRow
                  key={engagement.id}
                  organizationId={organizationId}
                  engagement={engagement}
                  callerIsAdmin={callerIsAdmin}
                />
              ))}
            </ul>
          ))}
      </Card>

      {callerIsAdmin && <CreateClientEngagementForm organizationId={organizationId} />}
    </div>
  );
}
