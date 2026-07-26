'use client';

import type { GardenMember, GardenRole } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { useState } from 'react';

import type { ApiFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, Card, FailureAlert, Select, StaleIndicator } from '@/shared/ui/public';

import { roleLabel } from './labels';
import styles from './ownership-transfer-panel.module.css';
import {
  useAcceptOwnershipTransfer,
  useCancelOwnershipTransfer,
  useDeclineOwnershipTransfer,
  useGardenOwnershipTransfer,
  useTransferOwnership,
} from './ownership-queries';

const RESULTING_ROLE_OPTIONS = [
  { value: 'editor', labelKey: 'gardens.roleEditor' },
  { value: 'viewer', labelKey: 'gardens.roleViewer' },
] as const;

type NonOwnerRole = Exclude<GardenRole, 'owner'>;

/** A failure whose code is `OwnershipTransferNotFound` is never worth its own `FailureAlert` — see each branch's own handling below. */
function isNotFoundFailure(failure: ApiFailure): boolean {
  return failure.code === CollaborationErrorCode.OwnershipTransferNotFound;
}

/**
 * Owner-side request/cancel UI, now backed by `useGardenOwnershipTransfer`
 * (P9A-OWNER-02) instead of the local "only known right after I requested it"
 * state this component used before that read existed.
 *
 * Cancelling still tolerates a concurrent `404`
 * (`collaboration.ownership_transfer.not_found`) — the recipient may have
 * just accepted or declined the same transfer between this component's last
 * read and the click — by silently refetching rather than surfacing it as a
 * failure: cancelling and finding nothing left to cancel both end at the
 * same place, "no transfer pending," which the refetch renders correctly on
 * its own.
 */
function OwnerTransferSection({
  gardenId,
  members,
}: {
  readonly gardenId: string;
  readonly members: readonly GardenMember[];
}) {
  const { t } = useLocalization();
  const [targetProfileId, setTargetProfileId] = useState('');
  const [resultingRole, setResultingRole] = useState<NonOwnerRole>('editor');

  const transferQuery = useGardenOwnershipTransfer(gardenId);
  const transferMutation = useTransferOwnership(gardenId);
  const cancelMutation = useCancelOwnershipTransfer(gardenId);

  const eligibleTargets = members.filter((member) => member.role !== 'owner');

  const onSubmit = () => {
    if (targetProfileId === '') {
      return;
    }
    transferMutation.mutate({ toProfileId: targetProfileId, resultingRole });
  };

  const onCancel = () => {
    if (!globalThis.confirm(t('ownership.cancelConfirm'))) {
      return;
    }
    cancelMutation.mutate(undefined, {
      onError: (error) => {
        if (isNotFoundFailure(error.failure)) {
          void transferQuery.refetch();
        }
      },
    });
  };

  if (transferQuery.isPending) {
    return (
      <Card title={t('ownership.requestTitle')}>
        <p role="status">{t('ownership.loading')}</p>
      </Card>
    );
  }

  if (transferQuery.isLoadingError) {
    return (
      <Card title={t('ownership.requestTitle')}>
        <div className={styles['errorState']}>
          <FailureAlert failure={transferQuery.error.failure} />
          <Button variant="secondary" onClick={() => void transferQuery.refetch()}>
            {t('ownership.retry')}
          </Button>
        </div>
      </Card>
    );
  }

  const pending = transferQuery.data;

  if (pending !== null) {
    return (
      <Card title={t('ownership.pendingTitle')}>
        <StaleIndicator failure={transferQuery.isError ? transferQuery.error.failure : null} />
        <Alert tone="info" title={t('ownership.pendingTitle')}>
          <p>
            {t('ownership.pendingDescription', {
              role: t(roleLabel(pending.fromResultingRole)),
            })}
          </p>
        </Alert>
        <Button variant="destructive" busy={cancelMutation.isPending} onClick={onCancel}>
          {t('ownership.cancel')}
        </Button>
        {cancelMutation.isError && !isNotFoundFailure(cancelMutation.error.failure) && (
          <FailureAlert failure={cancelMutation.error.failure} />
        )}
      </Card>
    );
  }

  return (
    <Card title={t('ownership.requestTitle')}>
      <StaleIndicator failure={transferQuery.isError ? transferQuery.error.failure : null} />
      <p className={styles['description']}>{t('ownership.requestDescription')}</p>

      {eligibleTargets.length === 0 ? (
        <p className={styles['empty']}>{t('ownership.noEligibleMembers')}</p>
      ) : (
        <div className={styles['form']}>
          <Select
            label={t('ownership.targetLabel')}
            options={[
              { value: '', label: t('ownership.targetPlaceholder') },
              ...eligibleTargets.map((member) => ({
                value: member.profileId,
                label: member.profileId,
              })),
            ]}
            value={targetProfileId}
            onChange={(event) => setTargetProfileId(event.target.value)}
          />
          <Select
            label={t('ownership.resultingRoleLabel')}
            options={RESULTING_ROLE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            value={resultingRole}
            onChange={(event) => setResultingRole(event.target.value as NonOwnerRole)}
          />
          <Button
            variant="primary"
            busy={transferMutation.isPending}
            disabled={targetProfileId === ''}
            onClick={onSubmit}
          >
            {t('ownership.submit')}
          </Button>
          {transferMutation.isError && <FailureAlert failure={transferMutation.error.failure} />}
        </div>
      )}
    </Card>
  );
}

type RecipientNotice = 'accepted' | 'declined' | 'gone' | null;

function recipientNoticeKey(notice: Exclude<RecipientNotice, null>) {
  switch (notice) {
    case 'accepted':
      return 'ownership.acceptedNotice' as const;
    case 'declined':
      return 'ownership.declinedNotice' as const;
    case 'gone':
      return 'ownership.noneForYou' as const;
  }
}

/**
 * Recipient-side accept/decline UI, now backed by `useGardenOwnershipTransfer`
 * instead of being shown unconditionally to every non-owner member. Renders
 * nothing when nothing is pending for the caller on this garden — the
 * cross-garden equivalent of that same "nothing to show" state is
 * `incoming-ownership-transfers.tsx`'s banner on the gardens list, which is
 * how a recipient now learns an offer exists in the first place without
 * being told out of band.
 *
 * A `404` on accept or decline still means "no longer available" rather than
 * a failure — the initiator may have cancelled between this component's last
 * read and the click — rendered as `ownership.noneForYou`, the same
 * information this component showed unconditionally before this read existed.
 */
function RecipientTransferSection({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const [notice, setNotice] = useState<RecipientNotice>(null);

  const transferQuery = useGardenOwnershipTransfer(gardenId);
  const acceptMutation = useAcceptOwnershipTransfer(gardenId);
  const declineMutation = useDeclineOwnershipTransfer(gardenId);

  const onAccept = () => {
    if (!globalThis.confirm(t('ownership.acceptConfirm'))) {
      return;
    }
    acceptMutation.mutate(undefined, {
      onSuccess: () => setNotice('accepted'),
      onError: (error) => {
        if (isNotFoundFailure(error.failure)) {
          setNotice('gone');
        }
      },
    });
  };

  const onDecline = () => {
    declineMutation.mutate(undefined, {
      onSuccess: () => setNotice('declined'),
      onError: (error) => {
        if (isNotFoundFailure(error.failure)) {
          setNotice('gone');
        }
      },
    });
  };

  if (notice !== null) {
    return (
      <Card title={t('ownership.respondTitle')}>
        <p role="status">{t(recipientNoticeKey(notice))}</p>
      </Card>
    );
  }

  if (transferQuery.isPending) {
    return (
      <Card title={t('ownership.respondTitle')}>
        <p role="status">{t('ownership.loading')}</p>
      </Card>
    );
  }

  if (transferQuery.isLoadingError) {
    return (
      <Card title={t('ownership.respondTitle')}>
        <div className={styles['errorState']}>
          <FailureAlert failure={transferQuery.error.failure} />
          <Button variant="secondary" onClick={() => void transferQuery.refetch()}>
            {t('ownership.retry')}
          </Button>
        </div>
      </Card>
    );
  }

  if (transferQuery.data === null) {
    return null;
  }

  return (
    <Card title={t('ownership.respondTitle')}>
      <StaleIndicator failure={transferQuery.isError ? transferQuery.error.failure : null} />
      <p className={styles['description']}>
        {t('ownership.respondDescription', { fromProfileId: transferQuery.data.fromProfileId })}
      </p>
      <div className={styles['actions']}>
        <Button variant="primary" busy={acceptMutation.isPending} onClick={onAccept}>
          {t('ownership.accept')}
        </Button>
        <Button variant="secondary" busy={declineMutation.isPending} onClick={onDecline}>
          {t('ownership.decline')}
        </Button>
      </div>
      {acceptMutation.isError && !isNotFoundFailure(acceptMutation.error.failure) && (
        <FailureAlert failure={acceptMutation.error.failure} />
      )}
      {declineMutation.isError && !isNotFoundFailure(declineMutation.error.failure) && (
        <FailureAlert failure={declineMutation.error.failure} />
      )}
    </Card>
  );
}

export interface OwnershipTransferPanelProps {
  readonly gardenId: string;
  readonly callerRole: GardenRole;
  readonly members: readonly GardenMember[];
}

/**
 * Ownership transfer (P9A-OWNER-01, matrix row H13; reads added by
 * P9A-OWNER-02): the owner branch requests and cancels a transfer; the
 * non-owner branch responds to one addressed to them. Both branches now read
 * `getGardenOwnershipTransfer` to know a transfer's real state — including
 * after a page reload — rather than inferring it from a mutation's own
 * response or showing controls unconditionally.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer".
 */
export function OwnershipTransferPanel({
  gardenId,
  callerRole,
  members,
}: OwnershipTransferPanelProps) {
  return callerRole === 'owner' ? (
    <OwnerTransferSection gardenId={gardenId} members={members} />
  ) : (
    <RecipientTransferSection gardenId={gardenId} />
  );
}
