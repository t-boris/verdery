'use client';

import type { SuitabilityFinding } from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import {
  formatSuitabilityValue,
  suitabilityAxisLabel,
  suitabilityCategoryLabel,
  suitabilityCategoryTone,
  suitabilityUnknownReasonLabel,
} from './labels';
import styles from './candidate-suitability-panel.module.css';
import { useCandidateSuitability, useRecalculateCandidateSuitability } from './queries';

export interface CandidateSuitabilityPanelProps {
  readonly gardenId: string;
  readonly candidateId: string;
}

/**
 * A candidate's latest suitability assessment against this garden's
 * recorded context (`GetCandidateSuitability`), with a button to compute a
 * fresh one (`RecalculateCandidateSuitability`) — the operation a client is
 * expected to call first, before any assessment exists at all.
 *
 * Renders every `SuitabilityFinding` per its own `category`: `match`/
 * `caution`/`blocker` show `explanation` and any `evidence`; `unknown`
 * shows only `reason` — never a fabricated explanation, "missing context
 * never becomes a positive match" (the schema's own description);
 * `assumption` also shows `assumedValue`. Three axes
 * (`hardiness`/`mature_space`/`user_preference`) have no rule producing
 * findings yet — a real, honest gap `SuitabilityAxis`'s own schema
 * description already documents, not something this panel needs to work
 * around: any axis simply absent from `findings` is just not rendered.
 *
 * Source: implementation-plan.md work package P11-SUIT-01, P11-WEB-01;
 * packages/api-contracts/openapi.yaml, operations `getCandidateSuitability`,
 * `recalculateCandidateSuitability`.
 */
export function CandidateSuitabilityPanel({
  gardenId,
  candidateId,
}: CandidateSuitabilityPanelProps) {
  const { t } = useLocalization();
  const query = useCandidateSuitability(gardenId, candidateId);
  const recalculate = useRecalculateCandidateSuitability(gardenId, candidateId);

  return (
    <div className={styles['panel']}>
      <p className={styles['description']}>{t('candidates.suitabilityDescription')}</p>

      {query.isPending && <p role="status">{t('candidates.suitabilityLoading')}</p>}
      {query.isError && <FailureAlert failure={query.error.failure} />}

      {!query.isPending && !query.isError && query.data === null && (
        <p>{t('candidates.suitabilityNone')}</p>
      )}

      {query.data !== null && query.data !== undefined && query.data.findings.length > 0 && (
        <ul className={styles['findings']}>
          {query.data.findings.map((finding, index) => (
            <SuitabilityFindingItem key={`${finding.axis}-${String(index)}`} finding={finding} />
          ))}
        </ul>
      )}

      <Button variant="secondary" busy={recalculate.isPending} onClick={() => recalculate.mutate()}>
        {recalculate.isPending
          ? t('candidates.suitabilityRecalculating')
          : t('candidates.suitabilityRecalculate')}
      </Button>
      {recalculate.isError && <FailureAlert failure={recalculate.error.failure} />}
    </div>
  );
}

function SuitabilityFindingItem({ finding }: { readonly finding: SuitabilityFinding }) {
  const { t } = useLocalization();

  return (
    <li className={styles['finding']}>
      <div className={styles['findingHeader']}>
        <span className={styles['axis']}>{t(suitabilityAxisLabel(finding.axis))}</span>
        <StatusPill
          tone={suitabilityCategoryTone(finding.category)}
          label={t(suitabilityCategoryLabel(finding.category))}
        />
      </div>

      {finding.category === 'unknown' && finding.reason !== undefined && (
        <p className={styles['reason']}>{t(suitabilityUnknownReasonLabel(finding.reason))}</p>
      )}

      {finding.category !== 'unknown' && finding.explanation !== undefined && (
        <p className={styles['explanation']}>{finding.explanation}</p>
      )}

      {finding.category === 'assumption' && finding.assumedValue !== undefined && (
        <p className={styles['assumedValue']}>
          {t('candidates.suitabilityAssumedValue', {
            value: formatSuitabilityValue(finding.assumedValue),
          })}
        </p>
      )}

      {finding.evidence !== undefined && finding.evidence.length > 0 && (
        <ul className={styles['evidence']}>
          {finding.evidence.map((evidence, index) => (
            <li key={`${evidence.factKey}-${String(index)}`}>
              {t('candidates.suitabilityEvidence')}: {evidence.factKey} —{' '}
              {formatSuitabilityValue(evidence.value)}
              {evidence.sourceCitation !== null ? ` (${evidence.sourceCitation})` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
