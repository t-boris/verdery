'use client';

import type { PlantCandidate, PlantCandidateStatus } from '@verdery/api-contracts';
import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert } from '@/shared/ui/public';

import { SETTABLE_CANDIDATE_STATUSES, candidateStatusLabel } from './labels';
import styles from './candidate-status-controls.module.css';
import { useSetCandidateStatus } from './queries';

export interface CandidateStatusControlsProps {
  readonly gardenId: string;
  readonly candidate: PlantCandidate;
}

/**
 * `SetCandidateStatus` — active/archived/rejected, never `converted`
 * (`SETTABLE_CANDIDATE_STATUSES` excludes it, mirroring the request
 * schema's own exclusion; `converted` is reachable only through
 * `candidate-convert-form.tsx`'s `convertCandidate`). Not rendered at all
 * once the candidate is already `converted` — see `candidate-detail.tsx`'s
 * own gating.
 *
 * Status choices apply immediately and are disabled while offline rather
 * than draft-persisted — a status pick is not free-text input a user could
 * lose, the same `disabled={!isOnline}` treatment
 * `features/plants/plant-lifecycle-controls.tsx` gives its own identical
 * status control.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `setCandidateStatus`.
 */
export function CandidateStatusControls({ gardenId, candidate }: CandidateStatusControlsProps) {
  const { t } = useLocalization();
  const mutation = useSetCandidateStatus(gardenId, candidate.id);
  const isOnline = useIsOnline();

  const setStatus = (status: PlantCandidateStatus) => {
    if (status === 'converted' || status === candidate.status || mutation.isPending) return;
    mutation.mutate({ input: { status }, expectedRevision: candidate.revision });
  };

  return (
    <div className={styles['panel']}>
      {SETTABLE_CANDIDATE_STATUSES.map((value) => (
        <Button
          key={value}
          variant={value === candidate.status ? 'primary' : 'secondary'}
          busy={mutation.isPending && mutation.variables?.input.status === value}
          disabled={!isOnline || mutation.isPending}
          aria-pressed={value === candidate.status}
          onClick={() => setStatus(value)}
        >
          {t(candidateStatusLabel(value))}
        </Button>
      ))}
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {mutation.isSuccess && <p role="status">{t('candidates.statusSaved')}</p>}
    </div>
  );
}
