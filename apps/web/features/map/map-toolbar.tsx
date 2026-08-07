'use client';

import type { CSSProperties } from 'react';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Button, CursorIcon, RedoIcon, UndoIcon } from '@/shared/ui/public';

import { styleForCategory } from './category-style';
import { useMapEditorStore } from './editor-store';
import { MapCategoryIcon } from './map-category-icon';
import { MapSaveStatus } from './map-save-status';
import { isCategoryLocked } from './map-layers';
import styles from './map-toolbar.module.css';
import { createToolMode } from './types';
import type { CreatableCategory } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

const TOOL_LABEL_KEY: Readonly<Record<CreatableCategory, MessageKey>> = {
  lot: 'map.toolbar.createLot',
  structure: 'map.toolbar.createStructure',
  fence: 'map.toolbar.createFence',
  gate: 'map.toolbar.createGate',
  path: 'map.toolbar.createPath',
  zone: 'map.toolbar.createZone',
  bed: 'map.toolbar.createBed',
  waterFeature: 'map.toolbar.createWaterFeature',
  utilityExclusion: 'map.toolbar.createUtilityExclusion',
  tree: 'map.toolbar.createTree',
  plant: 'map.toolbar.createPlant',
  annotation: 'map.toolbar.createAnnotation',
};

const TOOL_GROUPS: readonly {
  readonly labelKey: MessageKey;
  readonly categories: readonly CreatableCategory[];
}[] = [
  {
    labelKey: 'map.toolbar.groupBoundaries',
    categories: ['lot', 'structure', 'fence', 'gate', 'path'],
  },
  {
    labelKey: 'map.toolbar.groupGarden',
    categories: ['zone', 'bed', 'waterFeature', 'utilityExclusion'],
  },
  {
    labelKey: 'map.toolbar.groupLiving',
    categories: ['tree', 'plant', 'annotation'],
  },
];

export interface MapToolbarProps {
  readonly actions: MapEditorActions;
}

/**
 * Kern's tool rail: a 44px column of icon-only 44x44 buttons.
 *
 * The visible text label each button used to carry is gone — the rail is one
 * button wide. Nothing is lost to assistive technology or to a pointer user:
 * `aria-label` was already the accessible name (the visible text was
 * redundant with it) and `title` was already the tooltip, both asserted by
 * `e2e/keyboard.spec.ts`. The category's own colour tints the icon at rest,
 * but never carries state on its own.
 *
 * `aria-pressed` marks the active tool, so the filled-accent treatment is
 * never the only signal.
 *
 * The draft finish/cancel controls and the gate fence-pick prompt live in
 * `map-draft-controls.tsx`, over the canvas — they are transient, they need
 * real labels, and neither fits a 44px column.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 3 ("Tool rail").
 */
export function MapToolbar({ actions }: MapToolbarProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const tool = store.state.tool;

  const hasFence = actions.records.some((record) => record.category === 'fence');

  return (
    <div className={styles['rail']} role="toolbar" aria-label={t('map.toolbar.groupLabel')}>
      <div className={styles['group']} role="group" aria-label={t('map.toolbar.select')}>
        <span className={styles['toolButton']}>
          <Button
            variant="secondary"
            aria-pressed={tool === 'select'}
            aria-label={t('map.toolbar.select')}
            title={t('map.toolbar.select')}
            onClick={() => store.setTool('select')}
          >
            <CursorIcon />
          </Button>
        </span>
      </div>

      {TOOL_GROUPS.map((group) => (
        <div
          key={group.labelKey}
          className={styles['group']}
          role="group"
          aria-label={t(group.labelKey)}
        >
          {group.categories.map((category) => {
            const categoryTool = createToolMode(category);
            const locked = isCategoryLocked(category, store.state.lockedLayers);
            const disabled = locked || (category === 'gate' && !hasFence);
            const title = locked
              ? t('map.status.layerLocked')
              : category === 'gate' && !hasFence
                ? t('map.toolbar.gateNeedsFence')
                : t(TOOL_LABEL_KEY[category]);
            return (
              <span
                key={category}
                className={styles['toolButton']}
                style={
                  {
                    '--tool-color': styleForCategory(category).stroke,
                  } as CSSProperties
                }
              >
                <Button
                  variant="secondary"
                  aria-pressed={tool === categoryTool}
                  aria-label={t(TOOL_LABEL_KEY[category])}
                  title={title}
                  disabled={disabled}
                  onClick={() => store.setTool(categoryTool)}
                >
                  <MapCategoryIcon category={category} />
                </Button>
              </span>
            );
          })}
        </div>
      ))}

      <div className={styles['railFooter']} role="group" aria-label={t('map.history.title')}>
        <Button
          variant="secondary"
          busy={actions.isSubmitting}
          disabled={!actions.canUndo}
          aria-label={t('map.toolbar.undo')}
          title={t('map.toolbar.undo')}
          onClick={() => void actions.undo()}
        >
          <UndoIcon />
        </Button>
        <Button
          variant="secondary"
          busy={actions.isSubmitting}
          disabled={!actions.canRedo}
          aria-label={t('map.toolbar.redo')}
          title={t('map.toolbar.redo')}
          onClick={() => void actions.redo()}
        >
          <RedoIcon />
        </Button>
        <span className={styles['saveStatus']}>
          <MapSaveStatus status={actions.saveStatus} />
        </span>
      </div>
    </div>
  );
}
