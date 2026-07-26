'use client';

import type { Invitation } from '@verdery/api-contracts';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { invitationStateLabel, invitationStateTone, roleLabel } from './labels';
import styles from './pending-invitations.module.css';
import { useGardenInvitations, useRevokeInvitation } from './queries';

function InvitationRow({
  gardenId,
  invitation,
}: {
  readonly gardenId: string;
  readonly invitation: Invitation;
}) {
  const { t } = useLocalization();
  const revokeMutation = useRevokeInvitation(gardenId);

  const onRevoke = () => {
    if (globalThis.confirm(t('invitations.revokeConfirm'))) {
      revokeMutation.mutate(invitation.id);
    }
  };

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <span className={styles['email']}>
          {invitation.intendedEmail ?? t('invitations.noEmail')}
        </span>
        <StatusPill tone="neutral" label={t(roleLabel(invitation.intendedRole))} />
        <StatusPill
          tone={invitationStateTone(invitation.state)}
          label={t(invitationStateLabel(invitation.state))}
        />
      </div>
      {invitation.state === 'pending' && (
        <div className={styles['actions']}>
          <Button variant="destructive" busy={revokeMutation.isPending} onClick={onRevoke}>
            {t('invitations.revoke')}
          </Button>
        </div>
      )}
      {revokeMutation.isError && <FailureAlert failure={revokeMutation.error.failure} />}
    </li>
  );
}

/**
 * Every invitation this garden has ever issued, in every state — owner-only
 * (`listGardenInvitations`, unlike `listGardenMembers`: an invitation
 * carries an intended email, the enumeration surface
 * `garden-capability-matrix.md` reserves to the owner alone).
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listGardenInvitations`.
 */
export function PendingInvitations({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const query = useGardenInvitations(gardenId, { enabled: true });

  return (
    <Card title={t('invitations.pendingTitle')}>
      {query.isPending && <p role="status">{t('invitations.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('invitations.retry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError && query.data !== undefined && query.data.items.length === 0 && (
        <p className={styles['empty']}>{t('invitations.empty')}</p>
      )}

      {!query.isLoadingError && query.data !== undefined && query.data.items.length > 0 && (
        <ul className={styles['list']}>
          {query.data.items.map((invitation) => (
            <InvitationRow key={invitation.id} gardenId={gardenId} invitation={invitation} />
          ))}
        </ul>
      )}
    </Card>
  );
}
