'use client';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import styles from './map-toolbar.module.css';
import {
  CREATABLE_CATEGORIES,
  CREATABLE_GEOMETRY_KIND,
  createToolMode,
  creatableCategoryOfTool,
} from './types';
import type { CreatableCategory } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

const TOOL_LABEL_KEY: Readonly<Record<CreatableCategory, MessageKey>> = {
  lot: 'map.toolbar.createLot',
  structure: 'map.toolbar.createStructure',
  fence: 'map.toolbar.createFence',
  tree: 'map.toolbar.createTree',
  plant: 'map.toolbar.createPlant',
};

export interface MapToolbarProps {
  readonly actions: MapEditorActions;
}

/**
 * Tool selection, the draft finish/cancel controls, and undo/redo.
 *
 * `aria-pressed` marks the active tool, not colour alone — the `Button`
 * primitive's primary/secondary variants already differ in more than hue,
 * but the pressed state is exposed to assistive technology explicitly here
 * regardless.
 */
export function MapToolbar({ actions }: MapToolbarProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const tool = store.state.tool;
  const creatingCategory = creatableCategoryOfTool(tool);
  const draftKind = creatingCategory === null ? null : CREATABLE_GEOMETRY_KIND[creatingCategory];
  const isDrafting = draftKind === 'polygon' || draftKind === 'line';
  const minimumDraftPoints = draftKind === 'polygon' ? 3 : 2;

  return (
    <div className={styles['toolbar']}>
      <div className={styles['group']} role="group" aria-label={t('map.toolbar.groupLabel')}>
        <Button
          variant={tool === 'select' ? 'primary' : 'secondary'}
          aria-pressed={tool === 'select'}
          onClick={() => store.setTool('select')}
        >
          {t('map.toolbar.select')}
        </Button>
        {CREATABLE_CATEGORIES.map((category) => {
          const categoryTool = createToolMode(category);
          return (
            <Button
              key={category}
              variant={tool === categoryTool ? 'primary' : 'secondary'}
              aria-pressed={tool === categoryTool}
              onClick={() => store.setTool(categoryTool)}
            >
              {t(TOOL_LABEL_KEY[category])}
            </Button>
          );
        })}
      </div>

      {isDrafting && (
        <div className={styles['group']}>
          <Button
            variant="primary"
            disabled={store.state.draftPoints.length < minimumDraftPoints}
            onClick={() => void actions.finishDraft()}
          >
            {t('map.toolbar.finish')}
          </Button>
          <Button variant="secondary" onClick={actions.cancelDraft}>
            {t('map.toolbar.cancel')}
          </Button>
        </div>
      )}

      <div className={styles['group']} role="group" aria-label={t('map.history.title')}>
        <Button
          variant="secondary"
          busy={actions.isSubmitting}
          disabled={!actions.canUndo}
          onClick={() => void actions.undo()}
        >
          {t('map.toolbar.undo')}
        </Button>
        <Button
          variant="secondary"
          busy={actions.isSubmitting}
          disabled={!actions.canRedo}
          onClick={() => void actions.redo()}
        >
          {t('map.toolbar.redo')}
        </Button>
      </div>
    </div>
  );
}
