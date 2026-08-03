'use client';

import type {
  ObservationSymptomInput,
  ObservationSymptomKind,
  ObservationSymptomSeverity,
} from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { Button, CloseIcon, PlusIcon, Select } from '@/shared/ui/public';

import {
  OBSERVATION_SYMPTOM_KINDS,
  OBSERVATION_SYMPTOM_SEVERITIES,
  symptomKindLabel,
  symptomSeverityLabel,
} from './labels';
import styles from './observation-symptoms-field.module.css';

export interface ObservationSymptomsFieldProps {
  readonly value: readonly ObservationSymptomInput[];
  readonly onChange: (value: readonly ObservationSymptomInput[]) => void;
}

/**
 * What the observer says they saw (P11-MEDIA-01).
 *
 * These are not the health suggestions a model produces, and the two are never
 * shown as one list: an `ImageAnalysisResult` is a proposal awaiting a
 * disposition, and this is testimony. The vocabularies do not even overlap —
 * `stress` is a model's word and is not offered here.
 *
 * Each symptom may be reported once per observation
 * (`observation_symptom_unique_kind`), so the picker offers only symptoms no
 * other row holds and the add control disappears when all are in use — the
 * same rule the measurement field follows, for the same reason: a constraint
 * the server enforces should not first reach the reader as a refusal.
 *
 * Severity is three values, never a number. Two people would not report the
 * same leaf as the same score out of ten.
 *
 * Source: packages/api-contracts/openapi.yaml, schema
 * `ObservationSymptomInput`.
 */
export function ObservationSymptomsField({ value, onChange }: ObservationSymptomsFieldProps) {
  const { t } = useLocalization();

  const taken = new Set(value.map((symptom) => symptom.kind));
  const nextFreeKind = OBSERVATION_SYMPTOM_KINDS.find((kind) => !taken.has(kind));

  const replace = (kind: ObservationSymptomKind, next: ObservationSymptomInput) => {
    onChange(value.map((symptom) => (symptom.kind === kind ? next : symptom)));
  };

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t('observations.symptomsLegend')}</legend>

      {value.map((symptom) => (
        <div className={styles['row']} key={symptom.kind}>
          <Select
            label={t('observations.symptomKindLabel')}
            value={symptom.kind}
            onChange={(event) =>
              replace(symptom.kind, {
                ...symptom,
                kind: event.target.value as ObservationSymptomKind,
              })
            }
            options={OBSERVATION_SYMPTOM_KINDS.filter(
              (kind) => kind === symptom.kind || !taken.has(kind),
            ).map((kind) => ({ value: kind, label: t(symptomKindLabel(kind)) }))}
          />
          <Select
            label={t('observations.symptomSeverityLabel')}
            value={symptom.severity}
            onChange={(event) =>
              replace(symptom.kind, {
                ...symptom,
                severity: event.target.value as ObservationSymptomSeverity,
              })
            }
            options={OBSERVATION_SYMPTOM_SEVERITIES.map((severity) => ({
              value: severity,
              label: t(symptomSeverityLabel(severity)),
            }))}
          />
          <Button
            variant="secondary"
            iconOnly
            aria-label={t('observations.symptomRemove')}
            title={t('observations.symptomRemove')}
            onClick={() => onChange(value.filter((existing) => existing.kind !== symptom.kind))}
          >
            <CloseIcon />
          </Button>
        </div>
      ))}

      {nextFreeKind !== undefined && (
        <Button
          variant="secondary"
          onClick={() => onChange([...value, { kind: nextFreeKind, severity: 'mild' }])}
        >
          <PlusIcon />
          {t('observations.symptomAdd')}
        </Button>
      )}
    </fieldset>
  );
}
