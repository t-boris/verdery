'use client';

import type { PlantCandidate, PlantCandidateStatus } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, StatusPill } from '@/shared/ui/public';

import { SETTABLE_CANDIDATE_STATUSES, candidateStatusLabel, candidateStatusTone } from './labels';
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
 * The save action is disabled while offline rather than draft-persisted —
 * a status pick is not free-text input a user could lose, the same
 * `disabled={!isOnline}` treatment
 * `features/plants/plant-lifecycle-controls.tsx` gives its own identical
 * status control.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `setCandidateStatus`.
 */
type SettableCandidateStatus = Exclude<PlantCandidateStatus, 'converted'>;

/** This component is never rendered once `candidate.status === 'converted'` (see `candidate-detail.tsx`'s gating), so `'active'` is an unreachable-in-practice fallback rather than a real default. */
function settableStatus(status: PlantCandidateStatus): SettableCandidateStatus {
  return status === 'converted' ? 'active' : status;
}

export function CandidateStatusControls({ gardenId, candidate }: CandidateStatusControlsProps) {
  const { t } = useLocalization();
  const mutation = useSetCandidateStatus(gardenId, candidate.id);
  const [status, setStatus] = useState<SettableCandidateStatus>(settableStatus(candidate.status));
  const isOnline = useIsOnline();

  useEffect(() => setStatus(settableStatus(candidate.status)), [candidate.status]);

  const onSave = () => {
    if (status === candidate.status) {
      return;
    }
    mutation.mutate({ input: { status }, expectedRevision: candidate.revision });
  };

  return (
    <div className={styles['panel']}>
      <div className={styles['row']}>
        <Select
          label={t('candidates.statusTitle')}
          value={status}
          onChange={(event) => setStatus(event.target.value as SettableCandidateStatus)}
          options={SETTABLE_CANDIDATE_STATUSES.map((value) => ({
            value,
            label: t(candidateStatusLabel(value)),
          }))}
        />
        <Button variant="secondary" busy={mutation.isPending} disabled={!isOnline} onClick={onSave}>
          {t('candidates.saveStatus')}
        </Button>
        <StatusPill
          tone={candidateStatusTone(candidate.status)}
          label={t(candidateStatusLabel(candidate.status))}
        />
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {mutation.isSuccess && <p role="status">{t('candidates.statusSaved')}</p>}
    </div>
  );
}
