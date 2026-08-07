'use client';

import Link from 'next/link';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import {
  ActionDisclosure,
  Alert,
  Card,
  FailureAlert,
  PulseIcon,
  SparklesIcon,
  StaleIndicator,
  StatusPill,
  TrashIcon,
  TypeIcon,
} from '@/shared/ui/public';

import { CandidateConvertForm } from './candidate-convert-form';
import { CandidateDeleteControl } from './candidate-delete-control';
import { CandidateDetailsForm } from './candidate-details-form';
import { CandidateIdentificationPanel } from './candidate-identification-panel';
import { CandidatePhotoAnalysisPanel } from './candidate-photo-analysis-panel';
import styles from './candidate-detail.module.css';
import { CandidatePhotoGallery } from './candidate-photo-gallery';
import { CandidateStatusControls } from './candidate-status-controls';
import { CandidateSuitabilityPanel } from './candidate-suitability-panel';
import {
  candidateGroupingKindLabel,
  candidatePriorityLabel,
  candidateStatusLabel,
  candidateStatusTone,
} from './labels';
import { useCandidate, useCandidatePhotos } from './queries';
import { useTaxonomyReferenceSearch } from './taxonomy-queries';

export interface CandidateDetailProps {
  readonly gardenId: string;
  readonly candidateId: string;
}

function CandidateTaxonomySummary({
  gardenId,
  taxonomyReferenceId,
  displayName,
}: {
  readonly gardenId: string;
  readonly taxonomyReferenceId: string;
  readonly displayName: string;
}) {
  const { t } = useLocalization();
  const search = useTaxonomyReferenceSearch(gardenId, displayName);
  const reference = search.data?.items.find((item) => item.id === taxonomyReferenceId);

  if (reference === undefined) {
    return <span>{t('candidates.taxonomyLinked')}</span>;
  }

  return (
    <span>
      <i>{reference.scientificName}</i>
      {reference.commonName === null ? '' : ` · ${reference.commonName}`}
    </span>
  );
}

/**
 * A single plant candidate: its current facts, its suitability assessment
 * against this garden, and every command this pass wires against it.
 *
 * Once `status === 'converted'`, the edit/status/convert sections are
 * replaced with a plain notice and a link to the resulting plant
 * (`convertedByProfileId`/`convertedAt` themselves live on
 * `CandidateConversion`, not surfaced here). Permanent deletion remains
 * available: the API permits it after the resulting plant has been removed.
 * The suitability panel stays visible either way: it is a useful historical
 * read regardless of the candidate's current status.
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
  const photosQuery = useCandidatePhotos(gardenId, candidateId);

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
        <h2 className={styles['name']}>{candidate.displayName}</h2>
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
        {candidate.taxonomyReferenceId === null ? (
          <span>{t('candidates.taxonomyNone')}</span>
        ) : (
          <CandidateTaxonomySummary
            gardenId={gardenId}
            taxonomyReferenceId={candidate.taxonomyReferenceId}
            displayName={candidate.displayName}
          />
        )}
      </div>

      <CandidatePhotoGallery gardenId={gardenId} candidateId={candidate.id} />

      {candidate.photoAnalysis !== null && (
        <Card title={t('candidates.photoAnalysisTitle')}>
          <CandidatePhotoAnalysisPanel analysis={candidate.photoAnalysis} />
        </Card>
      )}

      {!isConverted && (photosQuery.data?.length ?? 0) > 0 && (
        <Card title={t('candidates.identificationTitle')}>
          <CandidateIdentificationPanel gardenId={gardenId} candidate={candidate} />
        </Card>
      )}

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

      <div className={styles['actionsGrid']}>
        {!isConverted && (
          <>
            <ActionDisclosure title={t('candidates.editTitle')} icon={<TypeIcon />}>
              <CandidateDetailsForm gardenId={gardenId} candidate={candidate} />
            </ActionDisclosure>

            <ActionDisclosure title={t('candidates.statusTitle')} icon={<PulseIcon />}>
              <CandidateStatusControls gardenId={gardenId} candidate={candidate} />
            </ActionDisclosure>

            <ActionDisclosure title={t('candidates.convertTitle')} icon={<SparklesIcon />}>
              <CandidateConvertForm gardenId={gardenId} candidate={candidate} />
            </ActionDisclosure>
          </>
        )}

        <ActionDisclosure title={t('candidates.deleteTitle')} icon={<TrashIcon />}>
          <CandidateDeleteControl gardenId={gardenId} candidate={candidate} />
        </ActionDisclosure>
      </div>
    </div>
  );
}
