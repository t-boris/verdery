'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import {
  ActionDisclosure,
  Button,
  Card,
  FailureAlert,
  PlusIcon,
  StaleIndicator,
} from '@/shared/ui/public';

import { AddOrganizationMemberForm } from './add-organization-member-form';
import { OrganizationMemberRow } from './organization-member-row';
import styles from './organization-members.module.css';
import { useOrganization, useOrganizationMembers } from './queries';

export interface OrganizationMembersProps {
  readonly organizationId: string;
}

/**
 * The organization's active membership roster — every role may read this
 * (`listOrganizationMembers`) — and, for an `organizationAdmin` caller
 * only, the form to add a new member.
 *
 * Fetches `useOrganization` itself (the SAME `['organizations',
 * organizationId]` query TanStack Query already dedupes with
 * `organization-header.tsx`'s own call) to learn the caller's own role,
 * rather than accepting it as a prop — the identical "second, independent
 * hook under the same cache key" pattern `features/collaboration/
 * queries.ts`'s own header documents for `useCallerRole`.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listOrganizationMembers`.
 */
export function OrganizationMembers({ organizationId }: OrganizationMembersProps) {
  const { t } = useLocalization();
  const roleQuery = useOrganization(organizationId);
  const membersQuery = useOrganizationMembers(organizationId);

  const callerIsAdmin = roleQuery.data?.callerRole === 'organizationAdmin';

  return (
    <div className={styles['list']}>
      <Card title={t('organizations.membersTitle')}>
        {membersQuery.isPending && <p role="status">{t('organizations.membersLoading')}</p>}

        {membersQuery.isLoadingError && (
          <div className={styles['errorState']}>
            <FailureAlert failure={membersQuery.error.failure} />
            <Button variant="secondary" onClick={() => void membersQuery.refetch()}>
              {t('organizations.membersRetry')}
            </Button>
          </div>
        )}

        {!membersQuery.isLoadingError && (
          <StaleIndicator failure={membersQuery.isError ? membersQuery.error.failure : null} />
        )}
        {membersQuery.isRefetchError && !isConnectivityFailure(membersQuery.error.failure) && (
          <FailureAlert failure={membersQuery.error.failure} />
        )}

        {!membersQuery.isLoadingError && membersQuery.data !== undefined && (
          <>
            <p className={styles['notice']}>{t('organizations.noDisplayName')}</p>
            <ul className={styles['list']}>
              {membersQuery.data.items.map((member) => (
                <OrganizationMemberRow
                  key={member.id}
                  organizationId={organizationId}
                  member={member}
                  callerIsAdmin={callerIsAdmin}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      {callerIsAdmin && (
        <ActionDisclosure title={t('organizations.addMemberTitle')} icon={<PlusIcon />}>
          <AddOrganizationMemberForm organizationId={organizationId} />
        </ActionDisclosure>
      )}
    </div>
  );
}
