'use client';

import type { ClientEngagement } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill, TextField } from '@/shared/ui/public';

import { engagementStateLabel, engagementStateTone } from './labels';
import styles from './organization-client-engagement-row.module.css';
import {
  useActivateClientEngagement,
  useEndClientEngagement,
  useRevokeClientEngagement,
} from './queries';

/**
 * One client engagement from the organization's own view: which garden,
 * its current state, stewardship policy, and notification setting — plus,
 * for an `organizationAdmin` caller only (`manageEngagement`), the
 * transitions valid FROM that state (`client-engagement-state.ts`'s own
 * diagram): `draft` offers activate or revoke; `active` offers end or
 * revoke; `ended`/`revoked` are terminal and offer neither, to anyone.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `activateClientEngagement`, `endClientEngagement`, `revokeClientEngagement`.
 */
export function OrganizationClientEngagementRow({
  organizationId,
  engagement,
  callerIsAdmin,
}: {
  readonly organizationId: string;
  readonly engagement: ClientEngagement;
  /** Whether the SIGNED-IN caller holds `manageEngagement` — never the engagement's own fields. */
  readonly callerIsAdmin: boolean;
}) {
  const { t } = useLocalization();
  const [reason, setReason] = useState('');

  const activateMutation = useActivateClientEngagement(organizationId);
  const endMutation = useEndClientEngagement(organizationId);
  const revokeMutation = useRevokeClientEngagement(organizationId);

  const onActivate = () => {
    if (globalThis.confirm(t('engagements.activateConfirm'))) {
      activateMutation.mutate(engagement.id);
    }
  };

  const onEnd = () => {
    if (globalThis.confirm(t('engagements.endConfirm'))) {
      endMutation.mutate(engagement.id);
    }
  };

  const onRevoke = () => {
    if (globalThis.confirm(t('engagements.revokeConfirm'))) {
      revokeMutation.mutate({
        engagementId: engagement.id,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
    }
  };

  const canRevoke = engagement.state === 'draft' || engagement.state === 'active';

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <span className={styles['identity']}>{engagement.gardenId}</span>
        <StatusPill
          tone={engagementStateTone(engagement.state)}
          label={t(engagementStateLabel(engagement.state))}
        />
        <StatusPill tone="neutral" label={t('engagements.stewardshipResidential')} />
        <StatusPill
          tone="neutral"
          label={t(
            engagement.clientNotificationsEnabled
              ? 'engagements.notificationsEnabled'
              : 'engagements.notificationsDisabled',
          )}
        />
      </div>

      {callerIsAdmin && (engagement.state === 'draft' || canRevoke) && (
        <div className={styles['actions']}>
          {engagement.state === 'draft' && (
            <Button variant="primary" busy={activateMutation.isPending} onClick={onActivate}>
              {t('engagements.activate')}
            </Button>
          )}
          {engagement.state === 'active' && (
            <Button variant="secondary" busy={endMutation.isPending} onClick={onEnd}>
              {t('engagements.end')}
            </Button>
          )}
          {canRevoke && (
            <>
              <TextField
                label={t('engagements.revokeReasonLabel')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button variant="destructive" busy={revokeMutation.isPending} onClick={onRevoke}>
                {t('engagements.revoke')}
              </Button>
            </>
          )}
        </div>
      )}

      {activateMutation.isError && <FailureAlert failure={activateMutation.error.failure} />}
      {endMutation.isError && <FailureAlert failure={endMutation.error.failure} />}
      {revokeMutation.isError && <FailureAlert failure={revokeMutation.error.failure} />}
    </li>
  );
}
