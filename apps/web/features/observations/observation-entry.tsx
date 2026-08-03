'use client';

import type { Observation } from '@verdery/api-contracts';
import { useState } from 'react';

import { formatInstant, useLocalization } from '@/shared/localization/public';
import { Button, StatusPill } from '@/shared/ui/public';

import {
  actorTypeLabel,
  correctionKindLabel,
  symptomKindLabel,
  symptomSeverityLabel,
} from './labels';
import { ObservationCorrectionForm } from './observation-correction-form';
import { ObservationPhotoAnalysis } from './observation-analysis-result';
import styles from './observation-entry.module.css';

export interface ObservationEntryProps {
  readonly gardenId: string;
  /** Whichever `plantId` scopes the timeline this entry is rendered in — `null` for the garden-wide view. */
  readonly plantId: string | null;
  readonly observation: Observation;
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
  const { t, locale } = useLocalization();
  const [correcting, setCorrecting] = useState(false);

  return (
    <li className={styles['entry']}>
      <div className={styles['header']}>
        <time dateTime={observation.observedAt}>
          {formatInstant(observation.observedAt, locale)}
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

      {observation.symptoms.length > 0 && (
        <div className={styles['symptoms']}>
          {/*
            Labelled as the observer's own, and rendered above the photo
            analyses rather than among them: a model's suggestion and a
            person's testimony must not read as one list.
          */}
          <span className={styles['symptomsLabel']}>{t('observations.symptomsReported')}</span>
          <ul className={styles['symptomsList']}>
            {observation.symptoms.map((symptom) => (
              <li key={symptom.id}>
                {t(symptomKindLabel(symptom.kind))} — {t(symptomSeverityLabel(symptom.severity))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {observation.photos.map((photo) => (
        <ObservationPhotoAnalysis
          key={photo.id}
          gardenId={gardenId}
          plantId={plantId}
          photo={photo}
        />
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
