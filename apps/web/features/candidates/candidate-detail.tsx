'use client';

import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { CandidateConvertForm } from './candidate-convert-form';
import { CandidateDetailsForm } from './candidate-details-form';
import styles from './candidate-detail.module.css';
import { CandidateStatusControls } from './candidate-status-controls';
import { CandidateSuitabilityPanel } from './candidate-suitability-panel';
import {
  candidateGroupingKindLabel,
  candidatePriorityLabel,
  candidateStatusLabel,
  candidateStatusTone,
} from './labels';
import { useCandidate } from './queries';

export interface CandidateDetailProps {
  readonly gardenId: string;
  readonly candidateId: string;
}

/**
 * A single plant candidate: its current facts, its suitability assessment
 * against this garden, and every command this pass wires against it.
 *
 * Once `status === 'converted'`, the edit/status/convert sections are
 * replaced with a plain notice and a link to the resulting plant
 * (`convertedByProfileId`/`convertedAt` themselves live on
 * `CandidateConversion`, not surfaced here — a converted candidate is a
 * frozen historical record, not something this page still lets a caller
 * act on). The suitability panel stays visible either way: it is a useful
 * historical read regardless of the candidate's current status.
 *
 * `PlantCandidate` carries no `alternativeToCandidateId` display yet — a
 * single, deliberately narrow self-reference the schema itself describes as
 * not a full alternatives-set model; resolving and rendering it needs a
 * second candidate fetch this first pass does not add.
 *
 * Source: implementation-plan.md work package P11-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getCandidate`.
 */
export function CandidateDetail({ gardenId, candidateId }: CandidateDetailProps) {
  const { t } = useLocalization();
  const query = useCandidate(gardenId, candidateId);

  if (query.isPending) {
    return <p role="status">{t('candidates.loading')}</p>;
  }

  // `isLoadingError`: a failed first load, with no cached data to fall back
  // to — the full failure state is all there is to show. A failed
  // background refetch (`isRefetchError`) instead falls through below,
  // `query.data` still holding the last successful result, per architecture
  // doc section "9. Online-First Behavior".
  if (query.isLoadingError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  const candidate = query.data;
  const isConverted = candidate.status === 'converted';

  return (
    <div className={styles['page']}>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      <div className={styles['summary']}>
        {/* The candidate's own name is this page's `<h1>` — mirrors
            `plant-detail.tsx`'s identical reasoning: the route renders no
            other top-level heading. */}
        <h1 className={styles['name']}>{candidate.displayName}</h1>
        <StatusPill
          tone={candidateStatusTone(candidate.status)}
          label={t(candidateStatusLabel(candidate.status))}
        />
        <span>{t(candidateGroupingKindLabel(candidate.groupingKind))}</span>
        {candidate.quantity !== null && (
          <span>{t('candidates.quantityDisplay', { quantity: candidate.quantity })}</span>
        )}
        {candidate.priority !== null && (
          <span>
            {t('candidates.priorityDisplay', {
              priority: t(candidatePriorityLabel(candidate.priority)),
            })}
          </span>
        )}
        {candidate.taxonomyReferenceId === null && <span>{t('candidates.taxonomyNone')}</span>}
      </div>

      {isConverted && (
        <Alert tone="info" title={t('candidates.alreadyConverted')}>
          <Link href={`/application/gardens/${gardenId}/plants`}>
            {t('candidates.convertedViewPlant')}
          </Link>
        </Alert>
      )}

      <Card title={t('candidates.suitabilityTitle')}>
        <CandidateSuitabilityPanel gardenId={gardenId} candidateId={candidate.id} />
      </Card>

      {!isConverted && (
        <>
          <Card title={t('candidates.editTitle')}>
            <CandidateDetailsForm gardenId={gardenId} candidate={candidate} />
          </Card>

          <Card title={t('candidates.statusTitle')}>
            <CandidateStatusControls gardenId={gardenId} candidate={candidate} />
          </Card>

          <Card title={t('candidates.convertTitle')}>
            <CandidateConvertForm gardenId={gardenId} candidate={candidate} />
          </Card>
        </>
      )}
    </div>
  );
}
