'use client';

import type { ClientUpdate } from '@verdery/api-contracts';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextField } from '@/shared/ui/public';

import styles from './client-update-lifecycle-controls.module.css';
import { usePublishClientUpdate, useSubmitClientUpdate, useWithdrawClientUpdate } from './queries';

export interface ClientUpdateLifecycleControlsProps {
  readonly engagementId: string;
  readonly update: ClientUpdate;
}

/**
 * The linear `internal_draft -> ready_for_client -> published -> withdrawn`
 * transition — `publication-state.ts`'s own state machine, mirrored
 * client-side ONLY for which single button to show; the server remains the
 * sole authority on whether a transition is actually valid.
 *
 * `submit` is disabled while `update.summary` is unset — the same field
 * `client-update-content-form.tsx` edits, so a caller sees exactly why
 * (`ClientUpdateErrorCode.SummaryRequired`, never round-tripped as a
 * request the server would reject).
 *
 * `publish`'s optional note becomes a SINGLE `timelineEntries[]` entry
 * stamped `occurredAt` = now — a deliberately minimal first pass of what
 * `PublishClientUpdateRequest` actually allows (also `gardenSnapshot` and
 * `staffAttributions`, both left for a later pass; see this component's own
 * scope note below).
 *
 * Source: packages/api-contracts/openapi.yaml, operations `submitClientUpdate`,
 * `publishClientUpdate`, `withdrawClientUpdate`.
 */
export function ClientUpdateLifecycleControls({
  engagementId,
  update,
}: ClientUpdateLifecycleControlsProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const submitMutation = useSubmitClientUpdate(engagementId, update.id);
  const publishMutation = usePublishClientUpdate(engagementId, update.id);
  const withdrawMutation = useWithdrawClientUpdate(engagementId, update.id);
  const [publishNote, setPublishNote] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');

  const hasSummary = update.summary !== undefined && update.summary.trim() !== '';

  const onSubmit = () => {
    if (!globalThis.confirm(t('publications.submitConfirm'))) {
      return;
    }
    submitMutation.mutate(update.revision);
  };

  const onPublish = () => {
    if (!globalThis.confirm(t('publications.publishConfirm'))) {
      return;
    }
    const trimmedNote = publishNote.trim();
    publishMutation.mutate({
      input: {
        timelineEntries:
          trimmedNote === ''
            ? []
            : [{ entryText: trimmedNote, occurredAt: new Date().toISOString() }],
      },
      expectedRevision: update.revision,
    });
  };

  const onWithdraw = () => {
    if (!globalThis.confirm(t('publications.withdrawConfirm'))) {
      return;
    }
    const trimmedReason = withdrawReason.trim();
    withdrawMutation.mutate({
      input: trimmedReason === '' ? {} : { reason: trimmedReason },
      expectedRevision: update.revision,
    });
  };

  return (
    <div className={styles['panel']}>
      {update.state === 'internal_draft' && (
        <div className={styles['action']}>
          <Button
            variant="primary"
            busy={submitMutation.isPending}
            disabled={!isOnline || !hasSummary}
            onClick={onSubmit}
          >
            {t('publications.submit')}
          </Button>
          {!hasSummary && (
            <p className={styles['hint']}>{t('publications.submitDisabledNoSummary')}</p>
          )}
          {submitMutation.isError && <FailureAlert failure={submitMutation.error.failure} />}
        </div>
      )}

      {update.state === 'ready_for_client' && (
        <div className={styles['action']}>
          <TextField
            label={t('publications.publishNoteLabel')}
            value={publishNote}
            onChange={(event) => setPublishNote(event.target.value)}
          />
          <p className={styles['hint']}>{t('publications.publishNoteHint')}</p>
          <Button
            variant="primary"
            busy={publishMutation.isPending}
            disabled={!isOnline}
            onClick={onPublish}
          >
            {t('publications.publish')}
          </Button>
          {publishMutation.isError && <FailureAlert failure={publishMutation.error.failure} />}
          {publishMutation.isSuccess && (
            <p role="status">
              {t('publications.publishedAs', { versionNumber: publishMutation.data.versionNumber })}
            </p>
          )}
        </div>
      )}

      {update.state === 'published' && (
        <div className={styles['action']}>
          <TextField
            label={t('publications.withdrawReasonLabel')}
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
          />
          <Button
            variant="destructive"
            busy={withdrawMutation.isPending}
            disabled={!isOnline}
            onClick={onWithdraw}
          >
            {t('publications.withdraw')}
          </Button>
          {withdrawMutation.isError && <FailureAlert failure={withdrawMutation.error.failure} />}
        </div>
      )}
    </div>
  );
}
