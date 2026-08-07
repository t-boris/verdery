'use client';

import type { PlantCandidate } from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert } from '@/shared/ui/public';

import { useIdentifyCandidateFromPhoto } from './queries';

export interface CandidateIdentificationPanelProps {
  readonly gardenId: string;
  readonly candidate: PlantCandidate;
}

export function CandidateIdentificationPanel({
  gardenId,
  candidate,
}: CandidateIdentificationPanelProps) {
  const { t } = useLocalization();
  const identification = useIdentifyCandidateFromPhoto(gardenId);

  return (
    <div>
      <p>{t('candidates.identificationDescription')}</p>
      <Button
        type="button"
        variant="primary"
        disabled={identification.isPending}
        onClick={() =>
          identification.mutate({
            candidateId: candidate.id,
            expectedRevision: candidate.revision,
          })
        }
      >
        {identification.isPending
          ? t('candidates.identificationPreparing')
          : t('candidates.identificationAction')}
      </Button>
      {identification.isSuccess && <p role="status">{t('candidates.identificationApplied')}</p>}
      {identification.isError && <FailureAlert failure={identification.error.failure} />}
    </div>
  );
}
