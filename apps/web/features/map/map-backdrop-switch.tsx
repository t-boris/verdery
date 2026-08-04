'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

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
export function MapBackdropSwitch({ available }: MapBackdropSwitchProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();

  return (
    <section className={styles['panel']} aria-label={t('map.backdrop.ariaLabel')}>
      <h3 className={styles['title']}>{t('map.backdrop.title')}</h3>

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
            <p className={styles['note']}>{t('map.backdrop.imageryNote')}</p>
          )}
        </>
      ) : (
        <p className={styles['note']}>{t('map.backdrop.needsLocation')}</p>
      )}
    </section>
  );
}
