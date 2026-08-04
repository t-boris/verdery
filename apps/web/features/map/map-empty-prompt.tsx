'use client';

import Link from 'next/link';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import styles from './map-empty-prompt.module.css';
import { createToolMode } from './types';

export interface MapEmptyPromptProps {
  readonly gardenId: string;
  /** `true` when the garden has a geographic anchor — the difference between "trace this" and "place this first". */
  readonly georeferenced: boolean;
}

/**
 * What to do with an empty map.
 *
 * A garden with no objects opens onto a blank canvas and a rail of thirteen
 * tools, which answers "what can I do" and not "what should I do first". The
 * product's own answer is the lot: every other object is placed inside it,
 * and with aerial imagery behind the canvas tracing it is the first thing
 * that makes the garden a real place rather than a name.
 *
 * Two states, because the honest next step differs:
 *
 * - Georeferenced: start the lot tool, over imagery of the actual property.
 * - Not yet: the map has nothing to sit on, so this points at the Location
 *   panel instead of offering a drawing that would float in the abstract.
 *
 * Disappears the moment the garden has any object — it is a first-run
 * prompt, not a permanent banner, and `map-editor.tsx` decides that by
 * counting objects rather than by remembering a dismissal.
 */
export function MapEmptyPrompt({ gardenId, georeferenced }: MapEmptyPromptProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();

  return (
    <div className={styles['prompt']} role="note">
      <p className={styles['title']}>
        {georeferenced ? t('map.empty.traceTitle') : t('map.empty.locateTitle')}
      </p>
      <p className={styles['body']}>
        {georeferenced ? t('map.empty.traceBody') : t('map.empty.locateBody')}
      </p>

      {georeferenced ? (
        <Button variant="primary" onClick={() => store.setTool(createToolMode('lot'))}>
          {t('map.empty.traceAction')}
        </Button>
      ) : (
        <Link className={styles['link']} href={`/application/gardens/${gardenId}`}>
          {t('map.empty.locateAction')}
        </Link>
      )}
    </div>
  );
}
