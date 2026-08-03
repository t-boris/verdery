'use client';

import type { ObservationPhotoPurpose, PlantJournalFrame } from '@verdery/api-contracts';
import { useState } from 'react';

import { formatInstant, useLocalization } from '@/shared/localization/public';
import { FailureAlert, Select, type SelectOption } from '@/shared/ui/public';

import { useJournalFrameAccess, usePlantJournalFrames } from './journal-queries';
import { OBSERVATION_PHOTO_PURPOSES, photoPurposeLabel } from './labels';
import styles from './plant-journal-strip.module.css';

export interface PlantJournalStripProps {
  readonly gardenId: string;
  readonly plantId: string;
}

interface JournalFrameProps {
  readonly gardenId: string;
  readonly frame: PlantJournalFrame;
}

/** The empty string is "every purpose", not a purpose — `<option value="">` is the only value a `<select>` can carry for "no narrowing". */
const ALL_PURPOSES = '';

function JournalFrame({ gardenId, frame }: JournalFrameProps) {
  const { t, locale } = useLocalization();
  const access = useJournalFrameAccess(gardenId, frame.mediaId);
  const observed = formatInstant(frame.observedAt, locale);

  return (
    <li className={styles['frame']}>
      {access.data === undefined ? (
        <div className={styles['placeholder']} />
      ) : (
        // A plain `<img>`, not `next/image`: the source is a short-lived signed
        // Cloud Storage URL re-issued on every fetch, not a static asset the
        // build can optimise. Same reasoning as `media-preview.tsx`.
        <img
          className={styles['thumbnail']}
          src={access.data.url}
          alt={
            frame.purpose === null
              ? t('observations.journalFrameAlt', { observed })
              : t('observations.journalFramePurposeAlt', {
                  observed,
                  purpose: t(photoPurposeLabel(frame.purpose)),
                })
          }
        />
      )}
      <time className={styles['observed']} dateTime={frame.observedAt}>
        {observed}
      </time>
    </li>
  );
}

/**
 * A plant's photographs in observed order, for reading growth as a sequence
 * (P11-MEDIA-01, comparison sets).
 *
 * NOT a time-lapse. Nothing is rendered into a video, on the server or here:
 * the frames are the photographs that already exist, laid out oldest-first so
 * two of them can be read side by side. That is the owner's own scope decision
 * and `ListPlantJournalFrames` states it too; without this note a later reader
 * takes the strip for an unfinished player.
 *
 * The purpose filter is the substance of the view rather than a convenience.
 * A sequence mixing whole-plant shots with leaf close-ups compares nothing, so
 * narrowing to one purpose is what makes consecutive frames readable against
 * each other. The unnarrowed default is deliberately the mixture: it is the
 * only setting that shows photographs carrying no purpose label at all, and
 * hiding those by default would make a plant's older history look empty.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `listPlantJournalFrames`.
 */
export function PlantJournalStrip({ gardenId, plantId }: PlantJournalStripProps) {
  const { t } = useLocalization();
  const [purpose, setPurpose] = useState<ObservationPhotoPurpose | ''>(ALL_PURPOSES);

  const query = usePlantJournalFrames(gardenId, plantId, {
    purpose: purpose === ALL_PURPOSES ? null : purpose,
  });

  const purposeOptions: readonly SelectOption[] = [
    { value: ALL_PURPOSES, label: t('observations.journalPurposeAll') },
    ...OBSERVATION_PHOTO_PURPOSES.map((value) => ({
      value,
      label: t(photoPurposeLabel(value)),
    })),
  ];

  return (
    <div className={styles['strip']}>
      <Select
        label={t('observations.journalPurposeLabel')}
        options={purposeOptions}
        value={purpose}
        onChange={(event) => setPurpose(event.target.value as ObservationPhotoPurpose | '')}
      />

      {query.isError && <FailureAlert failure={query.error.failure} />}

      {query.data !== undefined &&
        (query.data.items.length === 0 ? (
          // Distinguishes "no photographs at all" from "none of this kind":
          // the second is a filter the reader can undo, and saying only
          // "nothing here" would leave them guessing which one they hit.
          <p className={styles['empty']}>
            {purpose === ALL_PURPOSES
              ? t('observations.journalEmpty')
              : t('observations.journalEmptyForPurpose')}
          </p>
        ) : (
          <ol className={styles['frames']}>
            {query.data.items.map((frame) => (
              <JournalFrame key={frame.mediaId} gardenId={gardenId} frame={frame} />
            ))}
          </ol>
        ))}
    </div>
  );
}
