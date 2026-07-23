'use client';

import type { ImageAnalysisResult, Observation, ObservationPhoto } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, StatusPill } from '@/shared/ui/public';

import { actorTypeLabel, analysisKindLabel, correctionKindLabel } from './labels';
import { ObservationCorrectionForm } from './observation-correction-form';
import styles from './observation-entry.module.css';

export interface ObservationEntryProps {
  readonly gardenId: string;
  /** Whichever `plantId` scopes the timeline this entry is rendered in — `null` for the garden-wide view. */
  readonly plantId: string | null;
  readonly observation: Observation;
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100).toString()}%`;
}

/**
 * One analysis result on one photo, surfaced exactly as the backend
 * documents it: `requiresConfirmation` is always `true` in this stubbed
 * pass, so this is rendered as an unconfirmed suggestion, never as a
 * diagnosis — matching `ImageAnalysisResult`'s own schema description.
 */
function AnalysisResultNotice({ result }: { readonly result: ImageAnalysisResult }) {
  const { t } = useLocalization();

  return (
    <Alert tone="info" title={t(analysisKindLabel(result.analysisKind))}>
      <p>
        {t('observations.analysisSuggestion', {
          label: result.suggestedLabel,
          confidence: formatConfidence(result.confidenceScore),
        })}
      </p>
      {result.requiresConfirmation && <p>{t('observations.analysisRequiresConfirmation')}</p>}
      {result.requestedAdditionalEvidence && (
        <p>{t('observations.analysisRequestsMoreEvidence')}</p>
      )}
    </Alert>
  );
}

function ObservationPhotoAnalysis({ photo }: { readonly photo: ObservationPhoto }) {
  const { t } = useLocalization();

  if (photo.analysisResults.length === 0) {
    return null;
  }

  return (
    <div className={styles['photoAnalysis']}>
      <p className={styles['photoLabel']}>{t('observations.photoLabel')}</p>
      {photo.analysisResults.map((result) => (
        <AnalysisResultNotice key={result.id} result={result} />
      ))}
    </div>
  );
}

/**
 * One entry in an observation timeline.
 *
 * A correction is rendered as its own entry linked back to the observation
 * it corrects (`correctsObservationId`) — never as a replacement for it. The
 * "Correct this entry" action opens `ObservationCorrectionForm` inline and
 * always creates a new entry; the entry being corrected stays on the page
 * unchanged.
 *
 * Source: packages/api-contracts/openapi.yaml, schema `Observation`.
 */
export function ObservationEntry({ gardenId, plantId, observation }: ObservationEntryProps) {
  const { t } = useLocalization();
  const [correcting, setCorrecting] = useState(false);

  return (
    <li className={styles['entry']}>
      <div className={styles['header']}>
        <time dateTime={observation.observedAt}>
          {new Date(observation.observedAt).toLocaleString()}
        </time>
        <span className={styles['actor']}>{t(actorTypeLabel(observation.actorType))}</span>
        {observation.isCorrected && (
          <StatusPill tone="neutral" label={t('observations.isCorrectedBadge')} />
        )}
      </div>

      {observation.correctionKind !== null && (
        <p className={styles['correctionNotice']}>
          {t('observations.correctionOf', {
            kind: t(correctionKindLabel(observation.correctionKind)),
            id: observation.correctsObservationId ?? '',
          })}
        </p>
      )}

      {observation.noteText !== null && <p className={styles['note']}>{observation.noteText}</p>}
      {observation.conditionSummary !== null && (
        <p className={styles['conditionSummary']}>{observation.conditionSummary}</p>
      )}

      {observation.photos.map((photo) => (
        <ObservationPhotoAnalysis key={photo.id} photo={photo} />
      ))}

      {correcting ? (
        <ObservationCorrectionForm
          gardenId={gardenId}
          plantId={plantId}
          observationId={observation.id}
          onDone={() => setCorrecting(false)}
        />
      ) : (
        <Button variant="secondary" onClick={() => setCorrecting(true)}>
          {t('observations.correctAction')}
        </Button>
      )}
    </li>
  );
}
