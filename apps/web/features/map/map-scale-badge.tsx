'use client';

import type { WireGeoreference } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';

import styles from './map-scale-badge.module.css';
import { scaleStatusFor } from './scale-status';

export interface MapScaleBadgeProps {
  readonly georeference: WireGeoreference | undefined;
}

/**
 * Small corner overlay on the canvas surfacing whether this garden has a
 * real-world scale/geographic anchor at all, and how accurate it is when it
 * does — see `scale-status.ts`. A garden can begin, and stay, without a
 * georeference or a fixed scale at all: that is a normal, expected state,
 * not an error, so the no-scale case reads as neutral information rather
 * than a warning. `pointer-events: none` (in the CSS module) keeps this
 * overlay from intercepting clicks meant for the canvas underneath it.
 */
export function MapScaleBadge({ georeference }: MapScaleBadgeProps) {
  const { t } = useLocalization();
  const status = scaleStatusFor(georeference);

  return (
    <p className={styles['badge']} role="note">
      {t(status.key, status.args)}
    </p>
  );
}
