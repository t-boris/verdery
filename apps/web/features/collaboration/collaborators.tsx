'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import {
  ActionDisclosure,
  Button,
  FailureAlert,
  PlusIcon,
  StaleIndicator,
} from '@/shared/ui/public';

import styles from './collaborators.module.css';
import { InviteForm } from './invite-form';
import { MemberTable } from './member-table';
import { OwnershipTransferPanel } from './ownership-transfer-panel';
import { PendingInvitations } from './pending-invitations';
import { useCallerRole, useGardenMembers } from './queries';

export interface CollaboratorsProps {
  readonly gardenId: string;
}

/**
 * The garden settings page's Collaborators section: the member roster (every
 * role), invite creation and pending invitations (owner only), and
 * ownership transfer (both the owner-initiator and non-owner-recipient
 * views — see `ownership-transfer-panel.tsx`).
 *
 * A sibling to `GardenSettings`, not nested inside it — composed instead at
 * the `app/application/gardens/[gardenId]/page.tsx` level, the same way
 * `GardenPhotoUpload`/`GardenPlanUpload` already are. Features import public
 * Core and Shared interfaces only (architecture/web-application-design.md,
 * section "20. Dependency Rules"), so this feature never imports
 * `features/gardens` — it fetches the caller's own role itself
 * (`useCallerRole`), under the identical `['gardens', gardenId]` cache key
 * `features/gardens/queries.ts`'s `useGarden` already uses, so no second
 * network request actually happens in practice.
 *
 * Source: implementation-plan.md work package P9A-WEB-01;
 * docs/architecture/web-application-design.md, section "5. Application Structure".
 */
export function Collaborators({ gardenId }: CollaboratorsProps) {
  const { t } = useLocalization();
  const roleQuery = useCallerRole(gardenId);
  const membersQuery = useGardenMembers(gardenId);

  if (roleQuery.isPending) {
    return <p role="status">{t('collaborators.loading')}</p>;
  }

  // A caller whose access was revoked sees the same `garden.not_found` this
  // page's `GardenSettings` already handles identically — the API conceals
  // "no longer a member" behind the same code as "never existed"
  // (architecture/identity-and-authorization.md, section
  // "9.1 Implemented garden evaluation"). Showing the honest failure state
  // here, rather than a raw error or an infinite spinner, is that same
  // existing convention, not a new one.
  if (roleQuery.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={roleQuery.error.failure} />
        <Button variant="secondary" onClick={() => void roleQuery.refetch()}>
          {t('collaborators.retry')}
        </Button>
      </div>
    );
  }

  const callerIsOwner = roleQuery.data.callerRole === 'owner';

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('collaborators.title')}</h2>
      <StaleIndicator failure={roleQuery.isError ? roleQuery.error.failure : null} />
      {roleQuery.isRefetchError && !isConnectivityFailure(roleQuery.error.failure) && (
        <FailureAlert failure={roleQuery.error.failure} />
      )}

      <MemberTable gardenId={gardenId} callerIsOwner={callerIsOwner} />
      {callerIsOwner && (
        <ActionDisclosure title={t('invitations.inviteTitle')} icon={<PlusIcon />}>
          <InviteForm gardenId={gardenId} />
        </ActionDisclosure>
      )}
      {callerIsOwner && <PendingInvitations gardenId={gardenId} />}
      {membersQuery.data !== undefined && (
        <OwnershipTransferPanel
          gardenId={gardenId}
          callerRole={roleQuery.data.callerRole}
          members={membersQuery.data.items}
        />
      )}
    </div>
  );
}
