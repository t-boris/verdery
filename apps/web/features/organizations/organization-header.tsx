'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { organizationRoleLabel } from './labels';
import styles from './organization-header.module.css';
import { useOrganization } from './queries';

/**
 * A single organization's own identity: its name and the caller's own role
 * on it. Any ACTIVE member may read this (`getServiceOrganization`'s own
 * description) — a non-member sees the same concealed `organization.
 * not_found` `OrganizationList` and every other section on this page
 * already handle identically, per `getGarden`'s own established posture.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getServiceOrganization`.
 */
export function OrganizationHeader({ organizationId }: { readonly organizationId: string }) {
  const { t } = useLocalization();
  const query = useOrganization(organizationId);

  if (query.isPending) {
    return <p role="status">{t('organizations.loading')}</p>;
  }

  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('organizations.retry')}
        </Button>
      </div>
    );
  }

  const organization = query.data;

  return (
    <div className={styles['summary']}>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      <h1 className={styles['name']}>{organization.name}</h1>
      <StatusPill tone="neutral" label={t(organizationRoleLabel(organization.callerRole))} />
    </div>
  );
}
