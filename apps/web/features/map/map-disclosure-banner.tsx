'use client';

import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import styles from './map-disclosure-banner.module.css';

/**
 * "Not a legal survey" disclosure: garden geometry and measurements shown in
 * this editor are approximate, not authoritative property boundaries — see
 * architecture doc sections "10. Snapping and Constraints" and
 * "11. Validation" for the tolerances involved, and `measurement.ts`'s own
 * doc comment ("The schema must not imply survey accuracy merely because a
 * value uses a precise numeric type"). Rendered directly under the toolbar,
 * above the canvas, so it is visible without the user seeking it out.
 *
 * Dismissing it only hides it for the lifetime of this component instance —
 * plain `useState`, no persisted storage — so it reappears the next time the
 * map editor mounts (a fresh page load, or navigating back to this garden)
 * rather than being gone forever after one click.
 */
export function MapDisclosureBanner() {
  const { t } = useLocalization();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div className={styles['banner']} role="note">
      <p className={styles['text']}>{t('map.disclosure.text')}</p>
      <Button type="button" variant="secondary" onClick={() => setDismissed(true)}>
        {t('map.disclosure.dismiss')}
      </Button>
    </div>
  );
}
