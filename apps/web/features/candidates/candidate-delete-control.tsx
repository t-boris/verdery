'use client';

import type { PlantCandidate } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TrashIcon } from '@/shared/ui/public';

import styles from './candidate-delete-control.module.css';
import { useDeleteCandidate } from './queries';

export interface CandidateDeleteControlProps {
  readonly gardenId: string;
  readonly candidate: PlantCandidate;
}

/**
 * Permanent deletion, the counterpart to `candidate-status-controls.tsx`'s
 * archive and reject. Never rendered for a `converted` candidate — the API
 * refuses those, and offering an action that can only fail is worse than not
 * offering it (`candidate-detail.tsx` already gates this whole region).
 *
 * KEEPS ITS TEXT LABEL, unlike the icon-only controls elsewhere in this app.
 * An icon-only square is readable when it sits in a rail among its siblings
 * and its meaning can be inferred by comparison; this button stands alone and
 * cannot be undone, so the words are the affordance.
 *
 * The confirmation is a second click on the same control rather than a
 * `window.confirm`, which would block the browser's event loop and, in this
 * codebase, the automation that drives it. The pending state is local and
 * resets on cancel, so nothing about "am I about to delete" survives a
 * navigation.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `deleteCandidate`.
 */
export function CandidateDeleteControl({ gardenId, candidate }: CandidateDeleteControlProps) {
  const { t } = useLocalization();
  const router = useRouter();
  const isOnline = useIsOnline();
  const [confirming, setConfirming] = useState(false);
  const mutation = useDeleteCandidate(gardenId, candidate.id);

  const onDelete = () => {
    mutation.mutate(
      { expectedRevision: candidate.revision },
      {
        onSuccess: () => {
          router.push(`/application/gardens/${gardenId}/candidates`);
        },
      },
    );
  };

  return (
    <div className={styles['panel']}>
      <p className={styles['explanation']}>{t('candidates.deleteExplanation')}</p>

      {confirming ? (
        <div className={styles['actions']}>
          <Button
            variant="destructive"
            busy={mutation.isPending}
            disabled={!isOnline}
            onClick={onDelete}
          >
            <TrashIcon />
            {t('candidates.deleteConfirm')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t('candidates.deleteCancel')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" disabled={!isOnline} onClick={() => setConfirming(true)}>
          <TrashIcon />
          {t('candidates.deleteAction')}
        </Button>
      )}

      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </div>
  );
}
