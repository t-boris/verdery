'use client';

import type { CandidatePhotoAnalysis } from '@verdery/api-contracts';

import {
  formatCalendarDay,
  formatInstant,
  useLocalization,
  type MessageKey,
} from '@/shared/localization/public';
import { StatusPill, type StatusTone } from '@/shared/ui/public';

import styles from './candidate-photo-analysis-panel.module.css';

export interface CandidatePhotoAnalysisPanelProps {
  readonly analysis: CandidatePhotoAnalysis;
}

function confidenceLabel(score: number): string {
  return `${Math.round(score * 100).toString()}%`;
}

function lifecycleLabel(stage: string): MessageKey | null {
  const labels: Readonly<Record<string, MessageKey>> = {
    planned: 'plants.enum.lifecycleStage.planned',
    seed: 'plants.enum.lifecycleStage.seed',
    seedling: 'plants.enum.lifecycleStage.seedling',
    transplanted: 'plants.enum.lifecycleStage.transplanted',
    growing: 'plants.enum.lifecycleStage.growing',
    flowering: 'plants.enum.lifecycleStage.flowering',
    fruiting: 'plants.enum.lifecycleStage.fruiting',
    ready_to_harvest: 'plants.enum.lifecycleStage.readyToHarvest',
  };
  return labels[stage] ?? null;
}

function safetyPresentation(
  safetyClass: NonNullable<CandidatePhotoAnalysis['condition']>['safetyClass'],
): { readonly label: MessageKey; readonly tone: StatusTone } {
  switch (safetyClass) {
    case 'informational':
      return { label: 'candidates.photoAnalysisSafetyInformational', tone: 'neutral' };
    case 'monitor':
      return { label: 'candidates.photoAnalysisSafetyMonitor', tone: 'neutral' };
    case 'expert_review_recommended':
      return { label: 'candidates.photoAnalysisSafetyExpert', tone: 'negative' };
  }
}

/** Complete, explicitly unconfirmed result of both bounded photo-analysis passes. */
export function CandidatePhotoAnalysisPanel({ analysis }: CandidatePhotoAnalysisPanelProps) {
  const { t, locale } = useLocalization();
  const stageLabel = lifecycleLabel(analysis.lifecycleStage);
  const conditionSafety =
    analysis.condition === null ? null : safetyPresentation(analysis.condition.safetyClass);

  return (
    <div className={styles['analysis']}>
      <div className={styles['notice']}>
        <p>{t('candidates.photoAnalysisNotice')}</p>
        <span>
          {t('candidates.photoAnalysisAnalyzedAt', {
            date: formatInstant(analysis.analyzedAt, locale),
          })}
        </span>
      </div>

      <dl className={styles['facts']}>
        <div>
          <dt>{t('candidates.photoAnalysisScientificName')}</dt>
          <dd>
            <i>{analysis.scientificName}</i>
          </dd>
        </div>
        <div>
          <dt>{t('candidates.photoAnalysisCommonName')}</dt>
          <dd>{analysis.commonName}</dd>
        </div>
        <div>
          <dt>{t('candidates.photoAnalysisFamily')}</dt>
          <dd>{analysis.familyName}</dd>
        </div>
        <div>
          <dt>{t('candidates.photoAnalysisGenus')}</dt>
          <dd>
            <i>{analysis.genusName}</i>
          </dd>
        </div>
        {analysis.varietyLabel !== null && (
          <div>
            <dt>{t('candidates.photoAnalysisVariety')}</dt>
            <dd>{analysis.varietyLabel}</dd>
          </div>
        )}
        <div>
          <dt>{t('candidates.photoAnalysisConfidence')}</dt>
          <dd>{confidenceLabel(analysis.identificationConfidenceScore)}</dd>
        </div>
        <div>
          <dt>{t('candidates.photoAnalysisLifecycle')}</dt>
          <dd>{stageLabel === null ? analysis.lifecycleStage : t(stageLabel)}</dd>
        </div>
        <div>
          <dt>{t('candidates.photoAnalysisAge')}</dt>
          <dd>
            {t('candidates.photoAnalysisAgeValue', {
              min: analysis.estimatedAgeMonthsMin,
              max: analysis.estimatedAgeMonthsMax,
            })}
          </dd>
        </div>
        {analysis.estimatedAcquisitionDate !== null && (
          <div>
            <dt>{t('candidates.photoAnalysisAcquisition')}</dt>
            <dd>{formatCalendarDay(analysis.estimatedAcquisitionDate, locale)}</dd>
          </div>
        )}
      </dl>

      {analysis.condition !== null && conditionSafety !== null && (
        <section className={styles['condition']}>
          <div className={styles['conditionHeader']}>
            <div>
              <span className={styles['eyebrow']}>
                {t('candidates.photoAnalysisConditionTitle')}
              </span>
              <h3>{analysis.condition.label}</h3>
            </div>
            <StatusPill tone={conditionSafety.tone} label={t(conditionSafety.label)} />
          </div>
          <p>
            {t('candidates.photoAnalysisConditionConfidence', {
              confidence: confidenceLabel(analysis.condition.confidenceScore),
            })}
          </p>
          {analysis.condition.evidenceSummary !== '' && (
            <p>
              {t('candidates.photoAnalysisEvidence', {
                evidence: analysis.condition.evidenceSummary,
              })}
            </p>
          )}
          {analysis.condition.alternativeExplanations.length > 0 && (
            <div>
              <strong>{t('candidates.photoAnalysisAlternatives')}</strong>
              <ul>
                {analysis.condition.alternativeExplanations.map((explanation) => (
                  <li key={explanation}>{explanation}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.condition.careGuidance !== '' && (
            <p>
              {t('candidates.photoAnalysisCareGuidance', {
                guidance: analysis.condition.careGuidance,
              })}
            </p>
          )}
          {analysis.condition.requestedAdditionalEvidence && (
            <p>{t('candidates.photoAnalysisMoreEvidence')}</p>
          )}
          {analysis.condition.requestedViewPurposes.length > 0 && (
            <p>
              {t('candidates.photoAnalysisRequestedViews', {
                views: analysis.condition.requestedViewPurposes.join(', '),
              })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
