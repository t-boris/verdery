'use client';

import type { WireGeoreference } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';

import { IMAGERY_MAGNIFICATION_NOTICE, type BackdropState } from './backdrop-state';
import styles from './map-scale-badge.module.css';
import { scaleStatusFor } from './scale-status';

export interface MapScaleBadgeProps {
  readonly georeference: WireGeoreference | undefined;
  /** What the backdrop can draw here — the badge is where its own limits are admitted. */
  readonly backdrop: BackdropState;
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
export function MapScaleBadge({ georeference, backdrop }: MapScaleBadgeProps) {
  const { t } = useLocalization();
  const status = scaleStatusFor(georeference);
  /*
   * A photograph enlarged far past its own detail still looks like a
   * photograph, and a person reading a blurred roof deserves to know whether
   * they are seeing ground truth or fourteen screen pixels per NAIP pixel.
   * Below the notice threshold it stays quiet: this is a correction to an
   * impression, not a warning about a fault.
   */
  const magnification =
    backdrop.magnification !== null && backdrop.magnification > IMAGERY_MAGNIFICATION_NOTICE
      ? Math.round(backdrop.magnification)
      : null;

  return (
    <div className={styles['badge']}>
      <p role="note">{t(status.key, status.args)}</p>
      {magnification !== null && (
        <p role="note">{t('map.backdrop.magnified', { factor: magnification })}</p>
      )}
    </div>
  );
}
