'use client';

import type { PostponeRecommendationRequest, TodayRecommendation } from '@verdery/api-contracts';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextField } from '@/shared/ui/public';

import styles from './postpone-form.module.css';
import { usePostponeRecommendation } from './queries';

export interface PostponeFormProps {
  readonly gardenId: string;
  readonly item: TodayRecommendation;
  readonly onDone: () => void;
}

/**
 * The postpone control's panel: an OPTIONAL re-surfacing horizon and the
 * command itself. An empty input sends `postponedUntil: null` — the
 * contract applies no default, and the rule engine falls back to the rule's
 * own recurrence interval, so nothing is invented here either. `postponed`
 * is terminal for this candidate; re-surfacing later is the engine's job
 * (see the `postponeRecommendation` operation description).
 *
 * A `useState`-managed pair rather than React Hook Form: one optional
 * field with no validation rules — `task-row.tsx`'s completion-note input
 * takes the same shortcut for the same reason. Submission is offline-gated
 * like every command button.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `postponeRecommendation`.
 */
export function PostponeForm({ gardenId, item, onDone }: PostponeFormProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const [postponedUntil, setPostponedUntil] = useState('');
  const mutation = usePostponeRecommendation(gardenId, item.id);

  const onSubmit = () => {
    const input: PostponeRecommendationRequest = {
      postponedUntil: postponedUntil === '' ? null : new Date(postponedUntil).toISOString(),
    };
    mutation.mutate({ input, expectedRevision: item.revision }, { onSuccess: () => onDone() });
  };

  return (
    <div className={styles['form']}>
      <TextField
        label={t('today.postponeUntilLabel')}
        type="datetime-local"
        value={postponedUntil}
        onChange={(event) => setPostponedUntil(event.target.value)}
      />
      <div className={styles['actions']}>
        <Button variant="primary" busy={mutation.isPending} disabled={!isOnline} onClick={onSubmit}>
          {t('today.postponeSubmit')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('today.postponeCancel')}
        </Button>
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </div>
  );
}
