'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button, classNames } from '@/shared/ui/public';

import type { BackdropState } from './backdrop-state';
import { maxCameraScaleFor, openFreeMapProvider } from './basemap-provider';
import { useMapEditorStore, type BackdropKind } from './editor-store';
import type { WireGeoreference } from '@/core/api/public';
import styles from './map-backdrop-switch.module.css';

const BACKDROPS: readonly BackdropKind[] = ['imagery', 'streets', 'none'];

const LABEL_KEY = {
  imagery: 'map.backdrop.imagery',
  streets: 'map.backdrop.streets',
  none: 'map.backdrop.none',
} as const;

export interface MapBackdropSwitchProps {
  readonly georeference?: WireGeoreference;
  /** What the current choice can actually draw at the current camera. */
  readonly backdrop: BackdropState;
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
export function MapBackdropSwitch({ georeference, backdrop }: MapBackdropSwitchProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();

  return (
    <section className={styles['panel']} aria-label={t('map.backdrop.ariaLabel')}>
      {/* A label, not a heading: this cluster floats on the canvas after the
          page's own h1, and a lone h3 there is a heading-order violation. The
          section's `aria-label` already names it. */}
      <p className={styles['title']}>{t('map.backdrop.title')}</p>

      {georeference !== undefined ? (
        <>
          <div className={styles['options']} role="group" aria-label={t('map.backdrop.ariaLabel')}>
            {BACKDROPS.map((backdrop) => (
              <Button
                key={backdrop}
                variant="secondary"
                aria-pressed={store.state.backdrop === backdrop}
                onClick={() => {
                  store.setBackdrop(backdrop);
                  if (backdrop === 'streets') {
                    const maximum = maxCameraScaleFor(
                      openFreeMapProvider,
                      georeference.geographicAnchor[1],
                    );
                    if (store.state.camera.scale > maximum) {
                      store.setCamera({ ...store.state.camera, scale: maximum });
                    }
                  }
                }}
              >
                {t(LABEL_KEY[backdrop])}
              </Button>
            ))}
          </div>
          {store.state.backdrop === 'imagery' && (
            <p className={classNames(styles['note'], styles['noteStanding'])}>
              {t('map.backdrop.imageryNote')}
            </p>
          )}
          {/* The street style stops resolving about six zoom levels past its
              own tiles, which is well short of the scale a garden is drawn at
              — so at this camera it paints nothing. Saying that beats an
              unexplained empty field, and points at the backdrop that works. */}
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
