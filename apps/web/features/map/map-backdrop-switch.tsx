'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button, classNames } from '@/shared/ui/public';

import type { BackdropState } from './backdrop-state';
import { useMapEditorStore, type BackdropKind } from './editor-store';
import styles from './map-backdrop-switch.module.css';

const BACKDROPS: readonly BackdropKind[] = ['imagery', 'streets', 'none'];

const LABEL_KEY = {
  imagery: 'map.backdrop.imagery',
  streets: 'map.backdrop.streets',
  none: 'map.backdrop.none',
} as const;

export interface MapBackdropSwitchProps {
  /** `false` when the garden has no georeference, so there is nothing to place a backdrop against. */
  readonly available: boolean;
  /** What the current choice can actually draw at the current camera. */
  readonly backdrop: BackdropState;
  readonly onTraceAerial: () => void;
  readonly tracingAerial: boolean;
}

/**
 * What is drawn behind the garden: aerial imagery, streets, or nothing.
 *
 * Three buttons rather than a select, and `aria-pressed` rather than colour
 * alone — the same pattern the tool rail and the layer panel already use.
 *
 * When the garden has no geographic anchor there is nothing to align a
 * backdrop to, and the control says so instead of offering choices that would
 * all render the same empty canvas.
 *
 * Source: implementation-plan.md work package P12-GEO-01;
 * architecture/map-rendering-and-editing.md, section "3.2 Geographic Space".
 */
export function MapBackdropSwitch({
  available,
  backdrop,
  onTraceAerial,
  tracingAerial,
}: MapBackdropSwitchProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();

  return (
    <section className={styles['panel']} aria-label={t('map.backdrop.ariaLabel')}>
      {/* A label, not a heading: this cluster floats on the canvas after the
          page's own h1, and a lone h3 there is a heading-order violation. The
          section's `aria-label` already names it. */}
      <p className={styles['title']}>{t('map.backdrop.title')}</p>

      {available ? (
        <>
          <div className={styles['options']} role="group" aria-label={t('map.backdrop.ariaLabel')}>
            {BACKDROPS.map((backdrop) => (
              <Button
                key={backdrop}
                variant="secondary"
                aria-pressed={store.state.backdrop === backdrop}
                onClick={() => store.setBackdrop(backdrop)}
              >
                {t(LABEL_KEY[backdrop])}
              </Button>
            ))}
          </div>
          {store.state.backdrop === 'imagery' && (
            <>
              <p className={classNames(styles['note'], styles['noteStanding'])}>
                {t('map.backdrop.imageryNote')}
              </p>
              <Button variant="primary" busy={tracingAerial} onClick={onTraceAerial}>
                {t('map.aerial.detectAction')}
              </Button>
            </>
          )}
          {/* A provider beyond its camera ceiling would drift from geometry.
              Saying why it cannot go closer beats an unexplained zoom limit. */}
          {backdrop.beyondProviderDetail && (
            <p className={styles['note']}>{t('map.backdrop.tooCloseForStreets')}</p>
          )}
        </>
      ) : (
        <p className={styles['note']}>{t('map.backdrop.needsLocation')}</p>
      )}
    </section>
  );
}
