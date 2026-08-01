'use client';

import type { ClientUpdate } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextArea, TextField } from '@/shared/ui/public';

import styles from './client-update-content-form.module.css';
import { useUpdateClientUpdateContent } from './queries';

export interface ClientUpdateContentFormProps {
  readonly engagementId: string;
  readonly update: ClientUpdate;
}

/**
 * Edit form for `UpdateClientUpdateContentRequest` — `title` and `summary`,
 * the only two fields this endpoint accepts. Both are sent together on
 * every save (never a partial patch of just the changed one): simpler than
 * tracking which field actually changed, and harmless since both are
 * plain strings with no interaction between them.
 *
 * `summary` is what `submitClientUpdate` requires before a draft can leave
 * `internal_draft` (`ClientUpdateErrorCode.SummaryRequired`) —
 * `client-update-lifecycle-controls.tsx` disables its own submit action
 * until this component's own `update.summary` is non-empty, so the two
 * components read the same field rather than duplicating the rule.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `updateClientUpdateContent`.
 */
export function ClientUpdateContentForm({ engagementId, update }: ClientUpdateContentFormProps) {
  const { t } = useLocalization();
  const mutation = useUpdateClientUpdateContent(engagementId, update.id);
  const isOnline = useIsOnline();
  const [title, setTitle] = useState(update.title);
  const [summary, setSummary] = useState(update.summary ?? '');
  const [savedAnnouncement, setSavedAnnouncement] = useState(false);

  useEffect(() => {
    setTitle(update.title);
    setSummary(update.summary ?? '');
  }, [update.title, update.summary]);

  const onSave = () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      return;
    }
    const trimmedSummary = summary.trim();
    setSavedAnnouncement(false);
    mutation.mutate(
      {
        // `summary` is omitted entirely when blank, never sent as an empty
        // string — the server rejects a present-but-empty summary the same
        // way it rejects a present-but-empty title (`requireUpdateContentBody`).
        input: {
          title: trimmedTitle,
          ...(trimmedSummary === '' ? {} : { summary: trimmedSummary }),
        },
        expectedRevision: update.revision,
      },
      { onSuccess: () => setSavedAnnouncement(true) },
    );
  };

  return (
    <div className={styles['form']}>
      <TextField
        label={t('publications.editTitleLabel')}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextArea
        label={t('publications.editSummaryLabel')}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        rows={5}
      />
      <p className={styles['hint']}>{t('publications.editSummaryHint')}</p>
      <Button
        variant="primary"
        busy={mutation.isPending}
        disabled={!isOnline || title.trim() === ''}
        onClick={onSave}
      >
        {t('publications.editSave')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {savedAnnouncement && !mutation.isError && <p role="status">{t('publications.editSaved')}</p>}
    </div>
  );
}
