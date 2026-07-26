'use client';

import type { ServiceOrganization } from '@verdery/api-contracts';
import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { organizationRoleLabel } from './labels';
import styles from './organization-list.module.css';
import { useOrganizations } from './queries';

/**
 * Every service organization the signed-in profile has ACTIVE membership on
 * — `listServiceOrganizations`'s own scoping, the professional-service
 * mirror of `GardenList`/`listGardens`. There is no "every organization
 * that exists" listing: a profile with no membership anywhere sees the
 * empty state below, the same as a profile with no gardens.
 *
 * Source: implementation-plan.md work package P9B-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listServiceOrganizations`.
 */
export function OrganizationList() {
  const { t } = useLocalization();
  const query = useOrganizations();

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

  return (
    <>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      {query.data.items.length === 0 ? (
        <p className={styles['empty']}>{t('organizations.empty')}</p>
      ) : (
        <ul className={styles['list']}>
          {query.data.items.map((organization) => (
            <OrganizationListItem key={organization.id} organization={organization} />
          ))}
        </ul>
      )}
    </>
  );
}

function OrganizationListItem({ organization }: { readonly organization: ServiceOrganization }) {
  const { t } = useLocalization();

  return (
    <li className={styles['item']}>
      <Link className={styles['link']} href={`/application/organizations/${organization.id}`}>
        {organization.name}
      </Link>
      <span className={styles['meta']}>
        <StatusPill tone="neutral" label={t(organizationRoleLabel(organization.callerRole))} />
      </span>
    </li>
  );
}
