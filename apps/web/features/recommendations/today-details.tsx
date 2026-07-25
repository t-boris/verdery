'use client';

import type { TodayRecommendation } from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';

import {
  describeEvidenceReference,
  describeFactValue,
  describeFactorBasis,
  formatContribution,
} from './explainers';
import { evidenceKindLabel, priorityFactorKindLabel } from './labels';
import styles from './today-details.module.css';

export interface TodayDetailsProps {
  readonly item: TodayRecommendation;
}

/**
 * The expandable second layer of a Today card: the stored priority factors
 * (each with its signed contribution and readable basis — the same rows the
 * server summed into `priorityScore`, so this list reproduces the rank), the
 * structured evidence entries (FR-24's "Evidence used": kind, stable fact
 * key, the referenced record where one exists, and the generation-time
 * value snapshot), and the versioned rule identity the candidate pins.
 *
 * Rendering goes through `explainers.ts`, never raw JSON; display names are
 * resolved only from what the payload itself carries (the target plant's
 * name) — no per-row fetching.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas
 * `RecommendationPriorityFactor`, `RecommendationEvidence`;
 * technical-specification.md, FR-24.
 */
export function TodayDetails({ item }: TodayDetailsProps) {
  const { t } = useLocalization();

  return (
    <div className={styles['details']}>
      <p className={styles['ruleIdentity']}>
        {t('today.ruleIdentity', { key: item.ruleKey, version: item.ruleVersion })}
      </p>

      {item.priorityFactors.length > 0 && (
        <div>
          <h3 className={styles['sectionTitle']}>{t('today.factorsTitle')}</h3>
          <ul className={styles['entryList']}>
            {item.priorityFactors.map((factor) => {
              const basis = describeFactorBasis(factor.basis)
                .map((line) => t(line.key, line.args))
                .join('; ');
              return (
                <li key={factor.kind} className={styles['entry']}>
                  <span className={styles['entryName']}>
                    {t(priorityFactorKindLabel(factor.kind))}
                  </span>
                  <span>
                    {t('today.factorContribution', {
                      contribution: formatContribution(factor.contribution),
                    })}
                  </span>
                  {basis !== '' && <span className={styles['entryDetail']}>{basis}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className={styles['sectionTitle']}>{t('today.evidenceTitle')}</h3>
        <ul className={styles['entryList']}>
          {item.evidence.map((evidence) => {
            const reference = describeEvidenceReference(item, evidence);
            const valueLines = describeFactValue(evidence.factValue)
              .map((line) => t(line.key, line.args))
              .join('; ');
            return (
              <li key={evidence.id} className={styles['entry']}>
                <span className={styles['entryName']}>{t(evidenceKindLabel(evidence.kind))}</span>
                <span className={styles['factKey']}>{evidence.factKey}</span>
                {reference !== null && <span>{t(reference.key, reference.args)}</span>}
                {valueLines !== '' && <span className={styles['entryDetail']}>{valueLines}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
