'use client';

import type {
  HealthSuggestionDisposition,
  ImageAnalysisResult,
  ObservationPhoto,
} from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { formatInstant, useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert, Select, StatusPill } from '@/shared/ui/public';

import {
  HEALTH_SUGGESTION_DISPOSITIONS,
  analysisKindLabel,
  dispositionLabel,
  safetyClassLabel,
  safetyClassTone,
} from './labels';
import styles from './observation-analysis-result.module.css';
import { useSetHealthSuggestionDisposition } from './queries';

function formatConfidence(score: number): string {
  return `${Math.round(score * 100).toString()}%`;
}

export interface AnalysisResultNoticeProps {
  readonly gardenId: string;
  readonly plantId: string | null;
  readonly result: ImageAnalysisResult;
}

/**
 * One analysis result on one photo — the design doc's own "health
 * suggestion" (§9): an unconfirmed automated observation, never a
 * diagnosis. `requiresConfirmation` is always `true` (the schema's own
 * invariant, `analyzeObservationPhoto`'s own doc comment); the disposition
 * control lets a reviewer record what they did with the suggestion
 * (confirmed elsewhere, accepted as a real observation, rejected) without
 * ever mutating the suggestion itself — `SetHealthSuggestionDisposition`
 * only ever touches the 3 disposition columns.
 *
 * `modelName === null` means no provider was ever reached (disabled, quota
 * exhausted, timed out) — `suggestedLabel`/`confidenceScore` are a fixed
 * placeholder in that case (`analyzeObservationPhoto`'s own
 * `NO_ANALYSIS_OUTCOME`), so this renders an honest "no model reached"
 * notice instead of a suggestion line that would otherwise read as a real,
 * if low-confidence, analysis.
 *
 * Source: architecture/plant-intelligence-and-visual-journal.md,
 * section "9. Health Suggestions"; implementation-plan.md work package
 * P11-HEALTH-01; packages/api-contracts/openapi.yaml, schema
 * `ImageAnalysisResult`.
 */
export function AnalysisResultNotice({ gardenId, plantId, result }: AnalysisResultNoticeProps) {
  const { t, locale } = useLocalization();
  const mutation = useSetHealthSuggestionDisposition(gardenId, plantId);
  const [disposition, setDisposition] = useState<HealthSuggestionDisposition>(result.disposition);

  useEffect(() => setDisposition(result.disposition), [result.disposition]);

  const onSaveDisposition = () => {
    if (disposition === result.disposition) {
      return;
    }
    mutation.mutate({ analysisResultId: result.id, disposition });
  };

  const modelUnavailable = result.modelName === null;

  return (
    <Alert tone="info" title={t(analysisKindLabel(result.analysisKind))}>
      {modelUnavailable ? (
        <p>{t('observations.analysisModelUnavailable')}</p>
      ) : (
        <>
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
          {result.evidenceSummary !== '' && (
            <p>{t('observations.analysisEvidenceSummary', { summary: result.evidenceSummary })}</p>
          )}
          {result.alternativeExplanations.length > 0 && (
            <div>
              <p>{t('observations.analysisAlternativeExplanationsLabel')}</p>
              <ul className={styles['alternatives']}>
                {result.alternativeExplanations.map((explanation, index) => (
                  <li key={`${explanation}-${String(index)}`}>{explanation}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <StatusPill
        tone={safetyClassTone(result.safetyClass)}
        label={t(safetyClassLabel(result.safetyClass))}
      />

      <div className={styles['dispositionRow']}>
        <Select
          label={t('observations.analysisDispositionLabel')}
          value={disposition}
          onChange={(event) => setDisposition(event.target.value as HealthSuggestionDisposition)}
          options={HEALTH_SUGGESTION_DISPOSITIONS.map((value) => ({
            value,
            label: t(dispositionLabel(value)),
          }))}
        />
        <Button variant="secondary" busy={mutation.isPending} onClick={onSaveDisposition}>
          {t('observations.analysisSaveDisposition')}
        </Button>
      </div>
      {result.dispositionSetAt !== null && (
        <p className={styles['dispositionSetAt']}>
          {t('observations.analysisDispositionSetBy', {
            date: formatInstant(result.dispositionSetAt, locale),
          })}
        </p>
      )}
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {mutation.isSuccess && <p role="status">{t('observations.analysisDispositionSaved')}</p>}
    </Alert>
  );
}

export interface ObservationPhotoAnalysisProps {
  readonly gardenId: string;
  readonly plantId: string | null;
  readonly photo: ObservationPhoto;
}

export function ObservationPhotoAnalysis({
  gardenId,
  plantId,
  photo,
}: ObservationPhotoAnalysisProps) {
  const { t } = useLocalization();

  if (photo.analysisResults.length === 0) {
    return null;
  }

  return (
    <div className={styles['photoAnalysis']}>
      <p className={styles['photoLabel']}>{t('observations.photoLabel')}</p>
      {photo.analysisResults.map((result) => (
        <AnalysisResultNotice
          key={result.id}
          gardenId={gardenId}
          plantId={plantId}
          result={result}
        />
      ))}
    </div>
  );
}
